import Link from "next/link";
import { History } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Empty, formatDate } from "@/components/ui";
import { MANAGERS, cairoRange, requireRole } from "@/lib/auth";
import { getLocale, getT } from "@/lib/i18n/server";
import { cairoDateTime } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS, ROLE_LABELS } from "@/lib/types";

const TABLES: Record<string, string> = {
  leads: "الليدز",
  profiles: "الموظفين",
  teams: "التيمز",
  companies: "الشركات",
  agent_companies: "تعيين الشركات",
  daily_targets: "التارجت",
  tasks: "التاسكات",
  company_announcements: "البونص والإشعارات",
  work_locations: "أماكن الشغل",
  blacklist: "البلاك ليست",
  whatsapp_templates: "قوالب واتساب",
  lead_documents: "الأوراق",
  agent_breaks: "البريكات",
  leave_requests: "الإجازات",
};

const FIELDS: Record<string, string> = {
  status: "الحالة",
  agent_id: "الأجنت",
  notes: "ملاحظات",
  full_name: "الاسم",
  phone: "الموبايل",
  role: "الصلاحية",
  is_active: "نشط",
  team_id: "التيم",
  name: "الاسم",
  title: "العنوان",
  company_id: "الشركة",
  callback_at: "معاد المكالمة",
  interview_at: "معاد المقابلة",
  interview_place: "مكان المقابلة",
  target_leads: "تارجت ليدز",
  target_hired: "تارجت تعيين",
  location_id: "مكان الشغل",
  allow_anywhere: "يفتح من أي مكان",
  reason: "السبب",
  amount: "المبلغ (ج.م)",
  form_schema: "الفورم بتاعة الشركة",
  hired_at: "تاريخ التعيين",
  radius_m: "النطاق بالمتر",
};
const ACTION: Record<string, { label: string; cls: string }> = {
  insert: { label: "إضافة", cls: "bg-emerald-100 text-emerald-800" },
  update: { label: "تعديل", cls: "bg-sky-100 text-sky-800" },
  delete: { label: "حذف", cls: "bg-rose-100 text-rose-700" },
};
const PAGE = 100;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  await requireRole(...MANAGERS);
  const sp = await searchParams;
  const table = typeof sp.table === "string" && sp.table in TABLES ? sp.table : "";
  const actor = typeof sp.actor === "string" && UUID.test(sp.actor) ? sp.actor : "";
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase
    .from("audit_log")
    .select("id, at, actor_id, actor_name, table_name, row_id, action, changes", { count: "exact" })
    .order("at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (table) q = q.eq("table_name", table);
  if (actor) q = q.eq("actor_id", actor);
  if (day) {
    const [s, e] = cairoRange(day, day);
    q = q.gte("at", s).lt("at", e);
  }
  const [{ data, count }, people, teams, companies] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name").order("full_name"),
    supabase.from("teams").select("id, name"),
    supabase.from("companies").select("id, name"),
  ]);
  const leadIds = [...new Set((data ?? []).filter((e) => e.table_name === "leads" && e.row_id).map((e) => e.row_id as string))];
  const { data: leadRows } = leadIds.length ? await supabase.from("leads").select("id, full_name").in("id", leadIds) : { data: [] };
  const leadNames = new Map((leadRows ?? []).map((l) => [l.id, l.full_name]));
  const names = new Map<string, string>([
    ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string]),
    ...(teams.data ?? []).map((p) => [p.id, p.name] as [string, string]),
    ...(companies.data ?? []).map((p) => [p.id, p.name] as [string, string]),
  ]);

  const show = (key: string, v: unknown): string => {
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? t("نعم") : t("لا");
    if (typeof v === "string") {
      if (key === "status" && v in LEAD_STATUS_LABELS) return t(LEAD_STATUS_LABELS[v as keyof typeof LEAD_STATUS_LABELS]);
      if (key === "role" && v in ROLE_LABELS) return t(ROLE_LABELS[v as keyof typeof ROLE_LABELS]);
      if (UUID.test(v)) return names.get(v) ?? v.slice(0, 8);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return cairoDateTime(v, locale);
      return v.length > 80 ? `${v.slice(0, 80)}…` : v;
    }
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  };
  const summary = (c: Record<string, unknown>) =>
    ["full_name", "name", "title", "phone", "status", "agent_id", "company_id", "reason"].filter((k) => c[k] != null).slice(0, 3).map((k) => show(k, c[k])).join(" · ");
  const qs = (p: number) => new URLSearchParams({ ...(table && { table }), ...(actor && { actor }), ...(day && { day }), page: String(p) }).toString();
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <PageHeader title={t("سجل التعديلات")} subtitle={t("كل إضافة وتعديل وحذف في السيستم — مين عمل إيه وإمتى")} />
      <form className="card mb-4 grid gap-3 sm:grid-cols-4">
        <select name="table" defaultValue={table} className="input">
          <option value="">{t("كل الأقسام")}</option>
          {Object.entries(TABLES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        <select name="actor" defaultValue={actor} className="input">
          <option value="">{t("كل الناس")}</option>
          {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <input type="date" name="day" defaultValue={day} className="input" aria-label={t("التاريخ")} />
        <button className="btn-ghost">{t("فلتر")}</button>
      </form>

      <section className="card">
        {(data ?? []).length === 0 ? (
          <Empty icon={History}>{t("مفيش تعديلات")}</Empty>
        ) : (
          <ol className="divide-y divide-zinc-100">
            {(data ?? []).map((e) => {
              const changes = (e.changes ?? {}) as Record<string, unknown>;
              const a = ACTION[e.action];
              return (
                <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="w-44 shrink-0 text-xs text-zinc-500">
                    <p className="font-semibold text-ink">{e.actor_name ?? t("النظام")}</p>
                    <p>{formatDate(e.at)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={`badge ${a.cls}`}>{t(a.label)}</span>
                      <span className="font-semibold">{t(TABLES[e.table_name] ?? e.table_name)}</span>
                      {e.table_name === "leads" && e.action !== "delete" && e.row_id ? (
                        <Link href={`/admin/leads/${e.row_id}`} className="text-brand-700 hover:underline">
                          {(e.action === "insert" && summary(changes)) || leadNames.get(e.row_id) || t("فتح الليد")}
                        </Link>
                      ) : (
                        e.action !== "update" && <span className="text-zinc-600">{summary(changes)}</span>
                      )}
                    </p>
                    {e.action === "update" && (
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {Object.entries(changes).map(([k, v]) => {
                          const [before, after] = Array.isArray(v) ? v : [null, v];
                          return (
                            <li key={k} className="flex flex-wrap gap-1.5">
                              <span className="font-semibold text-zinc-600">{t(FIELDS[k] ?? k)}:</span>
                              <span className="text-rose-600 line-through decoration-rose-300">{show(k, before)}</span>
                              <span className="text-zinc-400">{t("{0} ← ", "").trim()}</span>
                              <span className="font-semibold text-emerald-700">{show(k, after)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {page > 1 && <Link className="btn-ghost" href={`/admin/audit?${qs(page - 1)}`}>{t("السابق")}</Link>}
            <span className="text-zinc-500">{t("صفحة")} {page} {t("من")} {pages}</span>
            {page < pages && <Link className="btn-ghost" href={`/admin/audit?${qs(page + 1)}`}>{t("التالي")}</Link>}
          </div>
        )}
      </section>
    </>
  );
}
