"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MANAGERS, requireRole, STAFF } from "@/lib/auth";
import { isValidEgyptMobile, normalizePhone, parseSchema } from "@/lib/forms";
import { MISSING_SERVICE_KEY, createAdminClient, hasServiceKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assignableRoles, canManageRole, type FormField, type Role } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function done(path: string, ok = "تم الحفظ"): ActionState {
  revalidatePath(path, "layout");
  return { ok };
}

// ───────── People ─────────
export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...MANAGERS);
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const fullName = str(form, "full_name");
  const role = str(form, "role") as Role;
  if (!fullName || !email) return { error: t("الاسم والإيميل مطلوبين") };
  if (password.length < 8) return { error: t("كلمة السر لازم 8 حروف على الأقل") };
  if (!["admin", "manager", "team_leader", "agent"].includes(role)) return { error: t("اختار الصلاحية") };
  if (!assignableRoles(me.role).includes(role)) return { error: t("المدير يقدر يضيف تيم ليدر أو أجنت بس — المدير والأدمن بيضيفهم الأدمن") };
  if (!hasServiceKey()) return { error: MISSING_SERVICE_KEY };

  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: str(form, "phone") || null },
  });
  if (error) return { error: error.message.includes("already") ? t("الإيميل ده متسجل قبل كده") : error.message };

  // The new profile starts inactive; finish setting it up with the service role (the caller's
  // right to create this role was checked above — managers may not otherwise change roles/activation).
  const { error: profileError } = await createAdminClient(me.id)
    .from("profiles")
    .update({
      role,
      team_id: str(form, "team_id") || null,
      location_id: str(form, "location_id") || null,
      allow_anywhere: form.get("allow_anywhere") === "on",
      is_active: true,
    })
    .eq("id", data.user.id);
  if (profileError) return { error: t("الحساب اتعمل بس الصلاحية متحفظتش — عدّلها من صفحة الموظف") };
  // The auth server creates the profile row, so the activity log can't tell who asked for it.
  await createAdminClient()
    .from("audit_log")
    .update({ actor_id: me.id, actor_name: me.full_name })
    .eq("table_name", "profiles")
    .eq("row_id", data.user.id)
    .eq("action", "insert")
    .is("actor_id", null);
  return done("/admin/agents", t("تم إنشاء حساب {0}", fullName));
}

export async function updateUser(form: FormData) {
  const me = await requireRole(...MANAGERS);
  const supabase = await createClient();
  const id = str(form, "id");
  const role = str(form, "role") as Role;
  const allowedRoles = assignableRoles(me.role);
  const self = id === me.id;
  // Deactivating someone is the admin's call; a manager may only switch people between
  // team leader and agent (the database enforces both).
  const activeLocked = self || me.role !== "admin";
  const { data: target } = await supabase.from("profiles").select("role").eq("id", id).maybeSingle();
  // A manager can't touch other managers or admins (the database enforces the same rule).
  if (!target || (!self && !canManageRole(me.role, target.role as Role))) return;
  await supabase
    .from("profiles")
    .update({
      full_name: str(form, "full_name"),
      phone: str(form, "phone") || null,
      // Nobody demotes or deactivates themselves by accident.
      role: !self && allowedRoles.includes(role) ? role : undefined,
      is_active: activeLocked ? undefined : form.get("is_active") === "on",
      team_id: str(form, "team_id") || null,
      location_id: str(form, "location_id") || null,
      allow_anywhere: form.get("allow_anywhere") === "on",
    })
    .eq("id", id);

  const password = str(form, "password");
  if (password.length >= 8 && hasServiceKey()) {
    await createAdminClient().auth.admin.updateUserById(id, { password });
  }
  revalidatePath("/admin", "layout");
}

export async function createTeam(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  const name = str(form, "name");
  if (!name) return { error: t("اكتب اسم التيم") };
  const leaderId = str(form, "leader_id") || null;
  const { data, error } = await supabase.from("teams").insert({ name, leader_id: leaderId }).select("id").single();
  if (error) return { error: t("اسم التيم موجود قبل كده") };
  // Only agents/team leaders become a team's leader role; a manager picked as leader keeps their role.
  if (leaderId) await supabase.from("profiles").update({ team_id: data.id, role: "team_leader" }).eq("id", leaderId).in("role", ["agent", "team_leader"]);
  return done("/admin/agents", t("تم إنشاء التيم"));
}

export async function updateTeam(form: FormData) {
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  const id = str(form, "id");
  const leaderId = str(form, "leader_id") || null;
  await supabase.from("teams").update({ name: str(form, "name"), leader_id: leaderId }).eq("id", id);
  if (leaderId) await supabase.from("profiles").update({ team_id: id, role: "team_leader" }).eq("id", leaderId).in("role", ["agent", "team_leader"]);
  revalidatePath("/admin", "layout");
}

// ───────── Assignments & targets ─────────
export async function saveAssignments(form: FormData) {
  const me = await requireRole(...STAFF);
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
  await requireRole(...STAFF);
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
  const t = await getT();
  await requireRole("admin");
  const name = str(form, "name");
  if (!name) return { error: t("اكتب اسم الشركة") };
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
  if (error) return { error: t("الشركة دي موجودة قبل كده") };
  revalidatePath("/admin", "layout");
  redirect(`/admin/companies/${data.id}`);
}

export async function updateCompany(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
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
  if (error) return { error: t("مقدرتش أحفظ") };

  const govs = form.getAll("governorate_id").map(Number);
  await supabase.from("company_governorates").delete().eq("company_id", id);
  if (govs.length) await supabase.from("company_governorates").insert(govs.map((g) => ({ company_id: id, governorate_id: g })));
  return done(`/admin/companies/${id}`);
}

export async function saveFormSchema(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  let schema;
  try {
    schema = parseSchema(str(form, "schema"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("companies").update({ form_schema: schema }).eq("id", str(form, "id"));
  if (error) return { error: t("مقدرتش أحفظ الفورم") };
  return done(`/admin/companies/${str(form, "id")}`, t("تم حفظ الفورم"));
}

// ───────── Announcements, notifications, tasks ─────────
export async function createAnnouncement(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const title = str(form, "title");
  const companyId = str(form, "company_id");
  if (!title || !companyId) return { error: t("اختار الشركة واكتب العنوان") };
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
  if (error) return { error: t("مقدرتش أنشر الإعلان") };
  return done("/admin", t("تم النشر وإرسال إشعار لكل الأجنتس المتعينين على الشركة"));
}

export async function sendMessage(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...STAFF);
  const title = str(form, "title");
  const recipients = form.getAll("user_id").map(String).filter(Boolean);
  if (!title || recipients.length === 0) return { error: t("اختار المستلمين واكتب الرسالة") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .insert(recipients.map((user_id) => ({ user_id, type: "info", title, body: str(form, "body") || null })));
  if (error) return { error: t("مقدرتش أبعت") };
  return done("/admin", t("اتبعتت لـ {0}", recipients.length));
}

export async function createTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const title = str(form, "title");
  const agentIds = form.getAll("agent_id").map(String).filter(Boolean);
  if (!title || agentIds.length === 0) return { error: t("اختار الأجنت واكتب التاسك") };
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
  if (error) return { error: t("مقدرتش أنشئ التاسك") };
  return done("/admin/tasks", t("تم إرسال التاسك لـ {0} أجنت", agentIds.length));
}

// ───────── Bulk import (CSV exported from Excel / the CRM) ─────────
const NAME_HEADERS = ["name", "full_name", "full name", "الاسم", "اسم", "الاسم بالكامل"];
const PHONE_HEADERS = ["phone", "mobile", "phone_number", "الموبايل", "رقم الموبايل", "التليفون", "الرقم", "رقم"];
const GOV_HEADERS = ["governorate", "city", "المحافظة", "محافظة"];
const REGION_HEADERS = ["region", "area", "المنطقة", "منطقة"];

export async function importLeads(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const file = form.get("file") as File | null;
  const companyId = str(form, "company_id");
  const distribute = str(form, "distribute");
  if (!file || file.size === 0 || !companyId) return { error: t("اختار الشركة والملف") };
  if (file.size > 5 * 1024 * 1024) return { error: t("الملف أكبر من 5 ميجا") };
  if (!hasServiceKey()) return { error: MISSING_SERVICE_KEY };

  const { parseCsv } = await import("@/lib/csv");
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return { error: t("الملف فاضي — لازم أول سطر يكون أسماء الأعمدة") };

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const find = (opts: string[]) => headers.findIndex((h) => opts.includes(h));
  const iName = find(NAME_HEADERS);
  const iPhone = find(PHONE_HEADERS);
  if (iName < 0 || iPhone < 0) return { error: t("لازم يكون فيه عمود للاسم (name / الاسم) وعمود للموبايل (phone / الموبايل)") };
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
  const banned = new Set<string>();
  const admin = createAdminClient();
  for (let i = 0; i < filePhones.length; i += 300) {
    const { data } = await admin.from("leads").select("phone").eq("company_id", companyId).in("phone", filePhones.slice(i, i + 300));
    for (const l of data ?? []) seen.add(l.phone);
    const { data: bl } = await admin.from("blacklist").select("phone").in("phone", filePhones.slice(i, i + 300));
    for (const b of bl ?? []) banned.add(b.phone);
  }

  const pool =
    distribute === "auto"
      ? ((assigned ?? []) as unknown as { profiles: { id: string; role: string; is_active: boolean } | null }[])
          .map((a) => a.profiles)
          .filter((p) => p?.is_active && p.role === "agent")
          .map((p) => p!.id)
      : [];
  if (distribute === "auto" && pool.length === 0) return { error: t("مفيش أجنتس متعينين على الشركة دي للتوزيع") };

  let skipped = 0;
  let dupes = 0;
  let blocked = 0;
  const toInsert = [];
  for (const r of rows.slice(1)) {
    const phone = normalizePhone(r[iPhone] ?? "");
    const fullName = (r[iName] ?? "").trim();
    if (!fullName || !isValidEgyptMobile(phone)) {
      skipped++;
      continue;
    }
    if (banned.has(phone)) {
      blocked++;
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
    if (error) return { error: t("اتسجل {0} بس — حصل خطأ: {1}", i, error.message) };
  }
  revalidatePath("/admin", "layout");
  const summary = t("اتسجل {0} ليد · {1} مكرر · {2} بيانات ناقصة", toInsert.length, dupes, skipped);
  return { ok: blocked ? `${summary} · ${t("{0} في البلاك ليست", blocked)}` : summary };
}

export async function deleteTask(form: FormData) {
  await requireRole(...STAFF);
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", str(form, "id"));
  revalidatePath("/admin/tasks");
}

// ───────── Work locations ─────────
export async function createLocation(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const name = str(form, "name");
  const radius = Math.round(Number(form.get("radius_m")) || 300);
  if (!name) return { error: t("اكتب اسم المكان (مثلاً: مصر الجديدة)") };
  if (radius < 50 || radius > 5000) return { error: t("نص القطر لازم يكون بين 50 و 5000 متر") };
  const { parseLocation } = await import("@/lib/geo");
  const coords = await parseLocation(str(form, "location"));
  if (!coords) return { error: t("مقدرتش أقرا اللوكيشن — ابعت لينك جوجل ماب أو الإحداثيات بالشكل ده: 30.0911, 31.3220") };
  const supabase = await createClient();
  const { error } = await supabase.from("work_locations").insert({ name, lat: coords.lat, lng: coords.lng, radius_m: radius });
  if (error) return { error: error.code === "23505" ? t("الاسم ده موجود قبل كده") : t("مقدرتش أحفظ المكان") };
  return done("/admin/locations", t("اتضاف {0} ({1}, {2})", name, coords.lat.toFixed(5), coords.lng.toFixed(5)));
}

export async function updateLocationRadius(form: FormData) {
  await requireRole(...MANAGERS);
  const radius = Math.round(Number(form.get("radius_m")));
  if (radius < 50 || radius > 5000) return;
  const supabase = await createClient();
  await supabase.from("work_locations").update({ radius_m: radius }).eq("id", str(form, "id"));
  revalidatePath("/admin/locations");
}

export async function deleteLocation(form: FormData) {
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  await supabase.from("work_locations").delete().eq("id", str(form, "id"));
  revalidatePath("/admin", "layout");
}

// ───────── Import a company's own form (pasted text or a Google Form link) ─────────
export type ImportState = { error?: string; fields?: FormField[]; source?: string } | undefined;

export async function importFormFields(_prev: ImportState, form: FormData): Promise<ImportState> {
  const t = await getT();
  await requireRole("admin");
  const input = str(form, "source");
  if (!input) return { error: t("الصق الفورم أو لينك Google Form") };
  const { parseFormText, parseGoogleForm } = await import("@/lib/form-import");
  try {
    const isLink = /^https?:\/\//i.test(input);
    const fields = isLink ? await parseGoogleForm(input) : parseFormText(input);
    if (fields.length === 0) return { error: t("ملقتش حقول — اكتب كل سؤال في سطر") };
    return { fields, source: isLink ? "Google Form" : t("النص") };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ───────── WhatsApp templates ─────────
export async function addTemplate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const title = str(form, "title").slice(0, 80);
  const body = str(form, "body").slice(0, 1500);
  if (!title || !body) return { error: t("اكتب اسم القالب والرسالة") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_templates")
    .insert({ title, body, company_id: str(form, "company_id") || null, created_by: me.id });
  if (error) return { error: t("مقدرتش أحفظ") };
  return done("/admin/templates", t("تم الحفظ"));
}

export async function deleteTemplate(form: FormData) {
  await requireRole(...STAFF);
  const supabase = await createClient();
  await supabase.from("whatsapp_templates").delete().eq("id", str(form, "id"));
  revalidatePath("/admin/templates");
}

// ───────── Blacklist ─────────
export async function addToBlacklist(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const phone = normalizePhone(str(form, "phone"));
  const reason = str(form, "reason").slice(0, 300);
  if (!isValidEgyptMobile(phone)) return { error: t("رقم الموبايل غير صحيح (لازم 11 رقم ويبدأ بـ 01)") };
  if (!reason) return { error: t("اكتب سبب الحظر") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("blacklist")
    .insert({ phone, reason, full_name: str(form, "full_name") || null, created_by: me.id });
  if (error) return { error: error.code === "23505" ? t("الرقم ده في البلاك ليست بالفعل") : t("مقدرتش أحفظ") };

  // Blocking from a lead page also closes every open lead with that number.
  const leadId = str(form, "lead_id");
  if (leadId) {
    await supabase.from("leads").update({ status: "rejected", callback_at: null }).eq("phone", phone).not("status", "in", "(hired,rejected)");
    await supabase.rpc("log_lead_note", { p_lead: leadId, p_note: `⛔ اتحظر: ${reason}`.slice(0, 300) });
  }
  revalidatePath("/", "layout");
  return { ok: t("الرقم اتحظر") };
}

export async function removeFromBlacklist(form: FormData) {
  await requireRole(...STAFF);
  const supabase = await createClient();
  await supabase.from("blacklist").delete().eq("id", str(form, "id"));
  revalidatePath("/admin/blacklist");
}

// ───────── Call script ─────────
export async function saveCallScript(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({ call_script: str(form, "call_script").slice(0, 4000) || null })
    .eq("id", str(form, "id"));
  if (error) return { error: t("مقدرتش أحفظ") };
  return done("/admin/companies", t("تم الحفظ"));
}
