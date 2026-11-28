import Link from "next/link";
import { saveCompanyRequest, setCompanyRequestStatus } from "@/app/actions/acquisition";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { CompanyLogo, Empty, Progress, StatCard } from "@/components/ui";
import { cairoToday, MANAGERS, requireRole, VIEWERS } from "@/lib/auth";
import { getGeo } from "@/lib/data";
import { getLocale, getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";
import { createClient } from "@/lib/supabase/server";
import { placeName, REQUEST_PRIORITIES, VEHICLES, type Governorate } from "@/lib/types";

type Req = {
  id: string; company_id: string; company: string; logo_path: string | null; governorate_id: number | null; governorate: string | null;
  vehicle: string | null; needed: number; starts_on: string; due_on: string | null; priority: number; status: "open" | "done" | "cancelled";
  notes: string | null; hired: number; in_pipe: number; remaining: number; days_left: number | null; per_day: number | null;
};

const STATUS_TABS = [
  { key: "open", label: "المفتوحة" },
  { key: "done", label: "اتنفذت" },
  { key: "cancelled", label: "اتلغت" },
] as const;
const PRIORITY_CLS: Record<number, string> = { 1: "bg-rose-50 text-rose-700 ring-rose-200", 2: "bg-zinc-100 text-zinc-600 ring-zinc-200", 3: "bg-sky-50 text-sky-700 ring-sky-200" };

/** What each company asked for, and how far we got. */
export default async function DemandPage({ searchParams }: PageProps<"/admin/demand">) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const me = await requireRole(...VIEWERS);
  const sp = await searchParams;
  const status = STATUS_TABS.some((s) => s.key === sp.status) ? (sp.status as string) : "open";
  const company = typeof sp.company === "string" && /^[0-9a-f-]{36}$/i.test(sp.company) ? sp.company : "";
  const canEdit = MANAGERS.includes(me.role);

  const supabase = await createClient();
  const [{ data, error }, { data: companies }, { governorates }] = await Promise.all([
    supabase.rpc("company_requests_progress", { p_status: status }),
    supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
    getGeo(),
  ]);

  if (error) {
    return (
      <>
        <PageHeader title={t("طلبات الشركات")} />
        <Empty>{t("الصفحة دي محتاجة migration 0061 — اتأكد إنه اتطبق في Supabase")}</Empty>
      </>
    );
  }
  const all = (data ?? []) as Req[];
  const rows = company ? all.filter((r) => r.company_id === company) : all;
  const open = rows.filter((r) => r.status === "open");
  const late = open.filter((r) => r.days_left !== null && r.days_left < 0 && r.remaining > 0);
  const needed = open.reduce((s, r) => s + r.needed, 0);
  const hired = open.reduce((s, r) => s + Math.min(r.hired, r.needed), 0);
  const link = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ ...(status !== "open" ? { status } : {}), ...(company ? { company } : {}), ...patch });
    for (const [k, v] of [...q.entries()]) if (!v || (k === "status" && v === "open")) q.delete(k);
    const s = q.toString();
    return `/admin/demand${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title={t("طلبات الشركات")} subtitle={t("كل شركة عايزة كام كابتن، فين، وإمتى — والتعيينات بتتحسب لوحدها")} />

      {status === "open" && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("طلبات مفتوحة")} value={open.length} emoji="📦" />
          <StatCard label={t("اتعيّن من المطلوب")} value={hired} progress={{ value: hired, target: needed }} tone="good" emoji="🎯" />
          <StatCard label={t("لسه ناقص")} value={Math.max(needed - hired, 0)} emoji="⏳" tone="brand" />
          <StatCard label={t("طلبات متأخرة")} value={late.length} emoji="🚨" tone={late.length ? "warn" : "default"} hint={late.length ? t("عدّى معادها ولسه ناقصة") : t("مفيش متأخر")} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
          {STATUS_TABS.map((s) => (
            <Link key={s.key} href={link({ status: s.key })} aria-current={s.key === status ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${s.key === status ? "bg-white text-(--fg) shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}>
              {t(s.label)}
            </Link>
          ))}
        </div>
        <form className="flex items-center gap-2" action="/admin/demand">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          <select name="company" defaultValue={company} className="input w-auto py-1.5 text-sm" aria-label={t("الشركة")}>
            <option value="">{t("كل الشركات")}</option>
            {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn-ghost btn-sm">{t("عرض")}</button>
        </form>
      </div>

      {canEdit && status === "open" && (
        <details className="card mb-5" open={all.length === 0}>
          <summary className="cursor-pointer font-semibold">➕ {t("طلب جديد")}</summary>
          <div className="mt-3">
            <RequestForm t={t} locale={locale} companies={companies ?? []} governorates={governorates} defaults={{ company_id: company }} />
          </div>
        </details>
      )}

      {rows.length === 0 ? (
        <Empty emoji="📦">{status === "open" ? t("مفيش طلبات مفتوحة. سجّل طلب كل شركة هنا عشان نعرف الأولويات.") : t("مفيش طلبات هنا")}</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => {
            const lateRow = r.status === "open" && r.days_left !== null && r.days_left < 0 && r.remaining > 0;
            return (
              <article key={r.id} className={`card space-y-3 ${lateRow ? "ring-2 ring-rose-300" : ""}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <CompanyLogo name={r.company} src={r.logo_path} size={40} />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold">{r.company}</h2>
                    <p className="text-sm text-zinc-500">
                      {r.governorate ? placeName({ name_ar: r.governorate, name_en: governorates.find((g) => g.id === r.governorate_id)?.name_en ?? null }, locale) : t("أي محافظة")}
                      {" · "}{r.vehicle ? t(r.vehicle) : t("أي مركبة")}
                    </p>
                  </div>
                  <span className={`badge ring-1 ${PRIORITY_CLS[r.priority]}`}>{t(REQUEST_PRIORITIES[r.priority])}</span>
                </div>
                <Progress value={Math.min(r.hired, r.needed)} target={r.needed} />
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <Cell label={t("اتعيّن")}>{r.hired}</Cell>
                  <Cell label={t("في المقابلات والأوراق")}>{r.in_pipe}</Cell>
                  <Cell label={t("ناقص")}>{r.remaining}</Cell>
                </dl>
                <p className={`text-sm ${lateRow ? "font-semibold text-rose-700" : "text-zinc-600"}`}>
                  {r.due_on === null
                    ? t("من غير آخر معاد")
                    : r.status !== "open"
                      ? t("آخر معاد {0}", r.due_on)
                      : r.days_left! < 0
                        ? t("متأخر {0} يوم (كان {1})", -r.days_left!, r.due_on)
                        : t("باقي {0} يوم · لحد {1}", r.days_left!, r.due_on)}
                  {r.per_day !== null && r.status === "open" && <span className="text-zinc-500"> · {t("محتاجين {0} تعيين في اليوم", r.per_day)}</span>}
                </p>
                {r.notes && <p className="rounded-lg bg-zinc-50 p-2 text-sm text-zinc-600">{r.notes}</p>}
                {canEdit && (
                  <div className="flex flex-wrap items-start gap-2 border-t border-zinc-100 pt-3">
                    {r.status === "open" ? (
                      <>
                        <StateForm action={setCompanyRequestStatus} submitLabel={t("✅ اتنفذ")}>
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="done" />
                        </StateForm>
                        <StateForm action={setCompanyRequestStatus} submitLabel={t("الغِ الطلب")}>
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="cancelled" />
                        </StateForm>
                      </>
                    ) : (
                      <StateForm action={setCompanyRequestStatus} submitLabel={t("افتحه تاني")}>
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="open" />
                      </StateForm>
                    )}
                    <details className="w-full text-sm">
                      <summary className="cursor-pointer text-zinc-500">✏️ {t("تعديل")}</summary>
                      <div className="mt-2">
                        <RequestForm t={t} locale={locale} companies={companies ?? []} governorates={governorates} defaults={r} />
                      </div>
                    </details>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-400">{t("التعيين بيتحسب للطلب لو الشركة والمحافظة والمركبة زي الطلب، واتعيّن من يوم بداية الطلب. النهارده {0}.", cairoToday())}</p>
    </>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="num text-lg font-bold">{children}</dd>
    </div>
  );
}

function RequestForm({ t, locale, companies, governorates, defaults }: {
  t: T; locale: string; companies: { id: string; name: string }[]; governorates: Governorate[];
  defaults: Partial<Pick<Req, "id" | "company_id" | "governorate_id" | "vehicle" | "needed" | "starts_on" | "due_on" | "priority" | "notes">>;
}) {
  const p = defaults.id ?? "new";
  return (
    <StateForm action={saveCompanyRequest} submitLabel={defaults.id ? t("حفظ") : t("أضف الطلب")} resetOnSuccess={!defaults.id} className="grid gap-3 sm:grid-cols-3">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <div>
        <label className="label" htmlFor={`${p}-company`}>{t("الشركة")}</label>
        <select id={`${p}-company`} name="company_id" required defaultValue={defaults.company_id ?? ""} className="input">
          <option value="" disabled>—</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${p}-gov`}>{t("المحافظة")}</label>
        <select id={`${p}-gov`} name="governorate_id" defaultValue={defaults.governorate_id ?? ""} className="input">
          <option value="">{t("أي محافظة")}</option>
          {governorates.map((g) => <option key={g.id} value={g.id}>{placeName(g, locale)}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${p}-vehicle`}>{t("المركبة")}</label>
        <select id={`${p}-vehicle`} name="vehicle" defaultValue={defaults.vehicle ?? ""} className="input">
          <option value="">{t("أي مركبة")}</option>
          {VEHICLES.filter((v) => v !== "بدون مركبة").map((v) => <option key={v} value={v}>{t(v)}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${p}-needed`}>{t("العدد المطلوب")}</label>
        <input id={`${p}-needed`} name="needed" type="number" min={1} max={5000} required defaultValue={defaults.needed ?? ""} className="input num" />
      </div>
      <div>
        <label className="label" htmlFor={`${p}-starts`}>{t("بيتحسب من يوم")}</label>
        <input id={`${p}-starts`} name="starts_on" type="date" defaultValue={defaults.starts_on ?? ""} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`${p}-due`}>{t("آخر معاد")}</label>
        <input id={`${p}-due`} name="due_on" type="date" defaultValue={defaults.due_on ?? ""} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`${p}-priority`}>{t("الأولوية")}</label>
        <select id={`${p}-priority`} name="priority" defaultValue={defaults.priority ?? 2} className="input">
          {Object.entries(REQUEST_PRIORITIES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${p}-notes`}>{t("ملاحظات")}</label>
        <input id={`${p}-notes`} name="notes" maxLength={500} defaultValue={defaults.notes ?? ""} placeholder={t("مثلاً: المقابلات في فرع مدينة نصر")} className="input" />
      </div>
    </StateForm>
  );
}
