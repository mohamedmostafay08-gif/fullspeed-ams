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
  const me = await requireRole(...STAFF);
  // A team leader only adds agents, always into their own team.
  if (me.role === "team_leader" && !me.team_id) return { error: t("إنت مش متعين على تيم") };
  const teamId = me.role === "team_leader" ? me.team_id : str(form, "team_id") || null;
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const fullName = str(form, "full_name");
  const role = str(form, "role") as Role;
  if (!fullName || !email) return { error: t("الاسم والإيميل مطلوبين") };
  if (password.length < 8) return { error: t("كلمة السر لازم 8 حروف على الأقل") };
  if (!["admin", "manager", "performance", "team_leader", "agent"].includes(role)) return { error: t("اختار الصلاحية") };
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
      team_id: teamId,
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
  if (me.role === "team_leader") {
    // Managers and the admin hear about agents a team leader adds.
    const { data: bosses } = await createAdminClient().from("profiles").select("id").in("role", ["admin", "manager"]).eq("is_active", true);
    await createAdminClient().from("notifications").insert(
      (bosses ?? []).map((b) => ({ user_id: b.id, type: "info", title: `👤 ${me.full_name} ضاف أجنت جديد: ${fullName}`, link: `/admin/agents/${data.user.id}` })),
    );
  }
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

// ───────── Team companies ─────────
export async function saveTeamCompanies(form: FormData) {
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  const teamId = str(form, "team_id");
  const wanted = new Set(form.getAll("company_id").map(String));
  const { data: current } = await supabase.from("team_companies").select("company_id").eq("team_id", teamId);
  const have = new Set((current ?? []).map((r) => r.company_id));
  const toAdd = [...wanted].filter((c) => !have.has(c)).map((company_id) => ({ team_id: teamId, company_id }));
  const toRemove = [...have].filter((c) => !wanted.has(c));
  if (toAdd.length) await supabase.from("team_companies").insert(toAdd);
  if (toRemove.length) await supabase.from("team_companies").delete().eq("team_id", teamId).in("company_id", toRemove);
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
  await requireRole(...MANAGERS);
  let schema;
  try {
    schema = parseSchema(str(form, "schema"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_company_content", { p_id: str(form, "id"), p_form_schema: schema, p_call_script: null, p_set_script: false });
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
// ───────── Lead import (the browser parses the file; the database does the rest) ─────────
type ImportRow = { n: string; p: string; g: string; r: string; x: Record<string, string> };
type ImportTotals = { inserted: number; dupes: number; skipped: number; blocked: number };

export async function importLeadRows(companyId: string, distribute: string, rows: ImportRow[]): Promise<ImportTotals | { error: string }> {
  const t = await getT();
  await requireRole(...STAFF);
  if (!companyId || !Array.isArray(rows) || rows.length > 2000) return { error: t("حصلت مشكلة، جرّب تاني") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_leads", { p_company: companyId, p_distribute: distribute, p_rows: rows });
  if (error) {
    if (error.message.includes("no_agents")) return { error: t("مفيش أجنتس متعينين على الشركة دي للتوزيع") };
    if (error.message.includes("agent_not_on_company")) return { error: t("الأجنت ده مش متعين على الشركة دي") };
    return { error: t("مقدرتش أستورد الملف") };
  }
  revalidatePath("/admin", "layout");
  return data as ImportTotals;
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
  await requireRole(...MANAGERS);
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
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_company_content", {
    p_id: str(form, "id"),
    p_form_schema: null,
    p_call_script: str(form, "call_script").slice(0, 4000),
    p_set_script: true,
  });
  if (error) return { error: t("مقدرتش أحفظ") };
  return done("/admin/companies", t("تم الحفظ"));
}

/** Pay and work terms: admin and managers. Extra terms are one per line, "label: value". */
export async function saveCompanyTerms(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const terms = str(form, "terms")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      const i = line.search(/[:：]/);
      return i > 0
        ? { label: line.slice(0, i).trim().slice(0, 60), value: line.slice(i + 1).trim().slice(0, 200) }
        : { label: t("شرط"), value: line.slice(0, 200) };
    })
    .filter((x) => x.label && x.value);
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_company_terms", {
    p_id: str(form, "id"),
    p_salary: str(form, "salary"),
    p_order_price: str(form, "order_price"),
    p_hours: str(form, "working_hours"),
    p_terms: terms,
  });
  if (error) return { error: t("مقدرتش أحفظ") };
  return done(`/admin/companies/${str(form, "id")}`, t("تم الحفظ"));
}

/** Monthly hiring target per team and company; the database splits it into the agents' daily targets. */
export async function saveTeamTargets(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const teamId = str(form, "team_id");
  const month = str(form, "month");
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { error: t("حصلت مشكلة، جرّب تاني") };
  const supabase = await createClient();
  let changed = 0;
  for (const companyId of form.getAll("company_id").map(String)) {
    const raw = str(form, `target_${companyId}`);
    if (raw === "" || raw === str(form, `was_${companyId}`)) continue;
    const target = Math.round(Number(raw));
    if (!Number.isFinite(target) || target < 0) return { error: t("التارجت لازم يكون رقم موجب") };
    const { error } = await supabase.rpc("set_team_target", { p_team: teamId, p_company: companyId, p_month: month, p_target: target });
    if (error) return { error: t("مقدرتش أحفظ") };
    changed++;
  }
  revalidatePath("/admin", "layout");
  return { ok: changed ? t("اتحفظ واتوزع على الأجنتس") : t("مفيش تغيير") };
}
