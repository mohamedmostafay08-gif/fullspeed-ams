"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { parseSchema } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function done(path: string, ok = "تم الحفظ"): ActionState {
  revalidatePath(path, "layout");
  return { ok };
}

// ───────── People ─────────
export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin");
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const fullName = str(form, "full_name");
  const role = str(form, "role") as Role;
  if (!fullName || !email) return { error: "الاسم والإيميل مطلوبين" };
  if (password.length < 8) return { error: "كلمة السر لازم 8 حروف على الأقل" };
  if (!["admin", "team_leader", "agent"].includes(role)) return { error: "اختار الصلاحية" };

  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: str(form, "phone") || null },
  });
  if (error) return { error: error.message.includes("already") ? "الإيميل ده متسجل قبل كده" : error.message };

  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role, team_id: str(form, "team_id") || null })
    .eq("id", data.user.id);
  if (profileError) return { error: "الحساب اتعمل بس الصلاحية متحفظتش — عدّلها من صفحة الموظف" };
  return done("/admin/agents", `تم إنشاء حساب ${fullName}`);
}

export async function updateUser(form: FormData) {
  await requireRole("admin");
  const supabase = await createClient();
  const role = str(form, "role") as Role;
  await supabase
    .from("profiles")
    .update({
      full_name: str(form, "full_name"),
      phone: str(form, "phone") || null,
      role: ["admin", "team_leader", "agent"].includes(role) ? role : undefined,
      team_id: str(form, "team_id") || null,
      is_active: form.get("is_active") === "on",
    })
    .eq("id", str(form, "id"));

  const password = str(form, "password");
  if (password.length >= 8) {
    await createAdminClient().auth.admin.updateUserById(str(form, "id"), { password });
  }
  revalidatePath("/admin", "layout");
}

export async function createTeam(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin");
  const supabase = await createClient();
  const name = str(form, "name");
  if (!name) return { error: "اكتب اسم التيم" };
  const leaderId = str(form, "leader_id") || null;
  const { data, error } = await supabase.from("teams").insert({ name, leader_id: leaderId }).select("id").single();
  if (error) return { error: "اسم التيم موجود قبل كده" };
  if (leaderId) await supabase.from("profiles").update({ team_id: data.id, role: "team_leader" }).eq("id", leaderId);
  return done("/admin/agents", "تم إنشاء التيم");
}

export async function updateTeam(form: FormData) {
  await requireRole("admin");
  const supabase = await createClient();
  const id = str(form, "id");
  const leaderId = str(form, "leader_id") || null;
  await supabase.from("teams").update({ name: str(form, "name"), leader_id: leaderId }).eq("id", id);
  if (leaderId) await supabase.from("profiles").update({ team_id: id, role: "team_leader" }).eq("id", leaderId);
  revalidatePath("/admin", "layout");
}

// ───────── Assignments & targets ─────────
export async function saveAssignments(form: FormData) {
  const me = await requireRole("admin", "team_leader");
  const supabase = await createClient();
  const agentId = str(form, "agent_id");
  const wanted = new Set(form.getAll("company_id").map(String));
  const { data: current } = await supabase.from("agent_companies").select("company_id").eq("agent_id", agentId);
  const have = new Set((current ?? []).map((r) => r.company_id));

  const toAdd = [...wanted].filter((c) => !have.has(c)).map((company_id) => ({ agent_id: agentId, company_id, assigned_by: me.id }));
  const toRemove = [...have].filter((c) => !wanted.has(c));
  if (toAdd.length) await supabase.from("agent_companies").insert(toAdd);
  if (toRemove.length) await supabase.from("agent_companies").delete().eq("agent_id", agentId).in("company_id", toRemove);
  revalidatePath("/admin", "layout");
}

export async function saveTargets(form: FormData) {
  await requireRole("admin", "team_leader");
  const supabase = await createClient();
  const agentId = str(form, "agent_id");
  const date = str(form, "date");
  const companyIds = form.getAll("company_id").map(String);
  const rows = companyIds.map((company_id) => ({
    agent_id: agentId,
    company_id,
    date,
    target_leads: Math.max(0, Number(form.get(`leads_${company_id}`)) || 0),
    target_hired: Math.max(0, Number(form.get(`hired_${company_id}`)) || 0),
  }));
  const dates = form.get("apply_week") === "on" ? weekFrom(date) : [date];
  const all = dates.flatMap((d) => rows.map((r) => ({ ...r, date: d })));
  if (all.length) await supabase.from("daily_targets").upsert(all, { onConflict: "agent_id,company_id,date" });
  revalidatePath("/admin", "layout");
}

function weekFrom(date: string): string[] {
  const start = new Date(`${date}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

// ───────── Companies ─────────
async function uploadLogo(file: File | null, slug: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (!file.type.startsWith("image/")) throw new Error("اللوجو لازم يكون صورة");
  if (file.size > 2 * 1024 * 1024) throw new Error("اللوجو أكبر من 2 ميجا");
  const supabase = await createClient();
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z]/g, "") || "png";
  const path = `${slug}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("logos").upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw new Error("مقدرتش أرفع اللوجو");
  return supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
}

function slugify(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `company-${Date.now()}`;
}

export async function createCompany(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin");
  const name = str(form, "name");
  if (!name) return { error: "اكتب اسم الشركة" };
  const slug = slugify(name);
  const supabase = await createClient();
  let logo: string | null;
  try {
    logo = await uploadLogo(form.get("logo") as File | null, slug);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { data, error } = await supabase
    .from("companies")
    .insert({ name, slug, logo_path: logo, description: str(form, "description") || null })
    .select("id")
    .single();
  if (error) return { error: "الشركة دي موجودة قبل كده" };
  revalidatePath("/admin", "layout");
  redirect(`/admin/companies/${data.id}`);
}

export async function updateCompany(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin");
  const supabase = await createClient();
  const id = str(form, "id");
  const patch: Record<string, unknown> = {
    name: str(form, "name"),
    description: str(form, "description") || null,
    is_active: form.get("is_active") === "on",
  };
  try {
    const logo = await uploadLogo(form.get("logo") as File | null, str(form, "slug"));
    if (logo) patch.logo_path = logo;
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { error } = await supabase.from("companies").update(patch).eq("id", id);
  if (error) return { error: "مقدرتش أحفظ" };

  const govs = form.getAll("governorate_id").map(Number);
  await supabase.from("company_governorates").delete().eq("company_id", id);
  if (govs.length) await supabase.from("company_governorates").insert(govs.map((g) => ({ company_id: id, governorate_id: g })));
  return done(`/admin/companies/${id}`);
}

export async function saveFormSchema(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin");
  let schema;
  try {
    schema = parseSchema(str(form, "schema"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("companies").update({ form_schema: schema }).eq("id", str(form, "id"));
  if (error) return { error: "مقدرتش أحفظ الفورم" };
  return done(`/admin/companies/${str(form, "id")}`, "تم حفظ الفورم");
}

// ───────── Announcements, notifications, tasks ─────────
export async function createAnnouncement(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireRole("admin", "team_leader");
  const title = str(form, "title");
  const companyId = str(form, "company_id");
  if (!title || !companyId) return { error: "اختار الشركة واكتب العنوان" };
  const type = str(form, "type");
  const amount = str(form, "amount");
  const supabase = await createClient();
  const { error } = await supabase.from("company_announcements").insert({
    company_id: companyId,
    type: ["bonus", "rate", "info"].includes(type) ? type : "info",
    title,
    body: str(form, "body") || null,
    amount: amount ? Number(amount) : null,
    valid_to: str(form, "valid_to") || null,
    created_by: me.id,
  });
  if (error) return { error: "مقدرتش أنشر الإعلان" };
  return done("/admin", "تم النشر وإرسال إشعار لكل الأجنتس المتعينين على الشركة");
}

export async function sendMessage(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin", "team_leader");
  const title = str(form, "title");
  const recipients = form.getAll("user_id").map(String).filter(Boolean);
  if (!title || recipients.length === 0) return { error: "اختار المستلمين واكتب الرسالة" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .insert(recipients.map((user_id) => ({ user_id, type: "info", title, body: str(form, "body") || null })));
  if (error) return { error: "مقدرتش أبعت" };
  return done("/admin", `اتبعتت لـ ${recipients.length}`);
}

export async function createTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireRole("admin", "team_leader");
  const title = str(form, "title");
  const agentIds = form.getAll("agent_id").map(String).filter(Boolean);
  if (!title || agentIds.length === 0) return { error: "اختار الأجنت واكتب التاسك" };
  const priority = str(form, "priority");
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert(
    agentIds.map((agent_id) => ({
      title,
      description: str(form, "description") || null,
      agent_id,
      company_id: str(form, "company_id") || null,
      due_date: str(form, "due_date") || null,
      priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
      assigned_by: me.id,
    })),
  );
  if (error) return { error: "مقدرتش أنشئ التاسك" };
  return done("/admin/tasks", `تم إرسال التاسك لـ ${agentIds.length} أجنت`);
}

// ───────── Bulk import (CSV exported from Excel / the CRM) ─────────
const NAME_HEADERS = ["name", "full_name", "full name", "الاسم", "اسم", "الاسم بالكامل"];
const PHONE_HEADERS = ["phone", "mobile", "phone_number", "الموبايل", "رقم الموبايل", "التليفون", "الرقم", "رقم"];
const GOV_HEADERS = ["governorate", "city", "المحافظة", "محافظة"];
const REGION_HEADERS = ["region", "area", "المنطقة", "منطقة"];

export async function importLeads(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireRole("admin", "team_leader");
  const file = form.get("file") as File | null;
  const companyId = str(form, "company_id");
  const distribute = str(form, "distribute");
  if (!file || file.size === 0 || !companyId) return { error: "اختار الشركة والملف" };
  if (file.size > 5 * 1024 * 1024) return { error: "الملف أكبر من 5 ميجا" };

  const { parseCsv } = await import("@/lib/csv");
  const { normalizePhone, isValidEgyptMobile } = await import("@/lib/forms");
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return { error: "الملف فاضي — لازم أول سطر يكون أسماء الأعمدة" };

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const find = (opts: string[]) => headers.findIndex((h) => opts.includes(h));
  const iName = find(NAME_HEADERS);
  const iPhone = find(PHONE_HEADERS);
  if (iName < 0 || iPhone < 0) return { error: "لازم يكون فيه عمود للاسم (name / الاسم) وعمود للموبايل (phone / الموبايل)" };
  const iGov = find(GOV_HEADERS);
  const iRegion = find(REGION_HEADERS);

  const supabase = await createClient();
  const [{ data: govs }, { data: regions }, { data: assigned }] = await Promise.all([
    supabase.from("governorates").select("id, name_ar, name_en"),
    supabase.from("regions").select("id, governorate_id, name_ar").limit(5000),
    supabase.from("agent_companies").select("profiles!agent_companies_agent_id_fkey(id, role, is_active)").eq("company_id", companyId),
  ]);
  const govByName = new Map<string, number>();
  for (const g of govs ?? []) {
    govByName.set(g.name_ar, g.id);
    govByName.set(g.name_en.toLowerCase(), g.id);
  }

  // Duplicate check must see every agent's leads, not only the caller's team.
  const filePhones = [...new Set(rows.slice(1).map((r) => normalizePhone(r[iPhone] ?? "")).filter(isValidEgyptMobile))];
  const seen = new Set<string>();
  const admin = createAdminClient();
  for (let i = 0; i < filePhones.length; i += 300) {
    const { data } = await admin.from("leads").select("phone").eq("company_id", companyId).in("phone", filePhones.slice(i, i + 300));
    for (const l of data ?? []) seen.add(l.phone);
  }

  const pool =
    distribute === "auto"
      ? ((assigned ?? []) as unknown as { profiles: { id: string; role: string; is_active: boolean } | null }[])
          .map((a) => a.profiles)
          .filter((p) => p?.is_active && p.role === "agent")
          .map((p) => p!.id)
      : [];
  if (distribute === "auto" && pool.length === 0) return { error: "مفيش أجنتس متعينين على الشركة دي للتوزيع" };

  let skipped = 0;
  let dupes = 0;
  const toInsert = [];
  for (const r of rows.slice(1)) {
    const phone = normalizePhone(r[iPhone] ?? "");
    const fullName = (r[iName] ?? "").trim();
    if (!fullName || !isValidEgyptMobile(phone)) {
      skipped++;
      continue;
    }
    if (seen.has(phone)) {
      dupes++;
      continue;
    }
    seen.add(phone);
    const govId = iGov >= 0 ? govByName.get((r[iGov] ?? "").trim()) ?? govByName.get((r[iGov] ?? "").trim().toLowerCase()) ?? null : null;
    const regionName = iRegion >= 0 ? (r[iRegion] ?? "").trim() : "";
    const regionId = regionName ? (regions ?? []).find((x) => x.name_ar === regionName && (!govId || x.governorate_id === govId))?.id ?? null : null;
    const extra: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (![iName, iPhone, iGov, iRegion].includes(i) && r[i]?.trim()) extra[rows[0][i].trim()] = r[i].trim().slice(0, 500);
    });
    const agent: string | null =
      distribute === "auto" ? pool[toInsert.length % pool.length] : distribute && distribute !== "none" ? distribute : null;
    toInsert.push({
      company_id: companyId,
      agent_id: agent,
      full_name: fullName.slice(0, 120),
      phone,
      governorate_id: govId,
      region_id: regionId,
      form_data: extra,
      source: "import",
      created_by: me.id,
    });
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase.from("leads").insert(toInsert.slice(i, i + 500));
    if (error) return { error: `اتسجل ${i} بس — حصل خطأ: ${error.message}` };
  }
  revalidatePath("/admin", "layout");
  return { ok: `اتسجل ${toInsert.length} ليد · ${dupes} مكرر · ${skipped} بيانات ناقصة` };
}

export async function deleteTask(form: FormData) {
  await requireRole("admin", "team_leader");
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", str(form, "id"));
  revalidatePath("/admin/tasks");
}
