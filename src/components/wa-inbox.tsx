import Link from "next/link";
import { ArrowRight, MessageCircle, Search } from "lucide-react";
import { waMakeLead } from "@/app/actions/wa";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { WaChat } from "@/components/wa-chat";
import { WaLive } from "@/components/wa-live";
import { getProfile } from "@/lib/auth";
import { getLocale, getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cairoTime } from "@/lib/time";

type Thread = {
  phone: string; contact_name: string | null; last_message: string | null; last_direction: string | null; last_at: string | null; unread: number;
  lead: { id: string; full_name: string; agent_id: string | null; agent: { full_name: string } | null; companies: { name: string } | null } | null;
};
const FILTERS = { all: "الكل", waiting: "مستني رد", unread: "مقرتش", mine: "بتوعي", nolead: "من غير ليد" } as const;
type Filter = keyof typeof FILTERS;

/** Shared WhatsApp inbox: conversations on one side, the open conversation on the other. */
export async function WaInbox({ base, sp, staff }: { base: string; sp: Record<string, string | string[] | undefined>; staff: boolean }) {
  const [t, locale, me] = await Promise.all([getT(), getLocale(), getProfile()]);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f: Filter = Object.hasOwn(FILTERS, str("f")) && (staff || str("f") !== "nolead") ? (str("f") as Filter) : "all";
  const q = str("q").trim().slice(0, 40);
  const selected = /^\d{8,15}$/.test(str("p")) ? str("p") : "";
  const supabase = await createClient();

  let query = supabase
    .from("wa_threads")
    .select("phone, contact_name, last_message, last_direction, last_at, unread, lead:leads(id, full_name, agent_id, agent:profiles!leads_agent_id_fkey(full_name), companies(name))")
    .order("last_at", { ascending: false, nullsFirst: false })
    .limit(150);
  if (f === "waiting") query = query.eq("last_direction", "in");
  if (f === "unread") query = query.gt("unread", 0);
  if (f === "nolead") query = query.is("lead_id", null);
  if (q) query = query.or(`phone.ilike.%${q.replace(/[^\d]/g, "") || "x"}%,contact_name.ilike.%${q.replace(/[%,()*\\]/g, "")}%`);
  const [{ data }, companiesRes] = await Promise.all([
    query,
    staff ? supabase.from("companies").select("id, name").eq("is_active", true).order("name") : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  let threads = (data ?? []) as unknown as Thread[];
  if (f === "mine") threads = threads.filter((th) => th.lead?.agent_id === me?.id);
  const current = threads.find((th) => th.phone === selected) ?? null;
  const link = (p: Record<string, string>) => `${base}?${new URLSearchParams({ ...(f !== "all" && { f }), ...(q && { q }), ...p })}`;
  const leadBase = staff ? "/admin/leads/" : "/agent/leads/";
  const waiting = threads.filter((th) => th.last_direction === "in").length;

  return (
    <>
      <WaLive channel={`inbox-${base}`} />
      <PageHeader title={t("واتساب")} subtitle={t("{0} محادثة · {1} مستنية رد", threads.length, waiting)} />
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <section className={`card flex flex-col gap-3 p-3 ${selected ? "hidden lg:flex" : ""}`}>
          <form className="relative">
            {f !== "all" && <input type="hidden" name="f" value={f} />}
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input name="q" defaultValue={q} placeholder={t("دوّر بالاسم أو الرقم")} className="input ps-9" />
          </form>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FILTERS) as Filter[]).filter((k) => staff || k !== "nolead").map((k) => (
              <Link key={k} href={`${base}?${new URLSearchParams({ ...(k !== "all" && { f: k }), ...(q && { q }) })}`} className={`chip ${k === f ? "chip-active" : ""}`}>{t(FILTERS[k])}</Link>
            ))}
          </div>
          {threads.length === 0 ? (
            <Empty icon={MessageCircle}>{t("مفيش محادثات")}</Empty>
          ) : (
            <ul className="-mx-1 max-h-[70vh] divide-y divide-(--glass-line) overflow-y-auto">
              {threads.map((th) => (
                <li key={th.phone}>
                  <Link href={link({ p: th.phone })} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-(--glass-strong) ${th.phone === selected ? "bg-brand-50" : ""}`}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-lg">{th.lead ? "💬" : "🆕"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{th.lead?.full_name ?? th.contact_name ?? th.phone}</span>
                        {th.last_at && <span className="num ms-auto shrink-0 text-[11px] text-zinc-400">{cairoTime(th.last_at, locale)}</span>}
                      </p>
                      <p className="flex items-center gap-2 text-xs text-zinc-500">
                        <span className="truncate">{th.last_direction === "out" ? "↩︎ " : ""}{th.last_message}</span>
                        {th.unread > 0 && <span className="num ms-auto grid min-w-5 shrink-0 place-items-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-white">{th.unread}</span>}
                      </p>
                      {staff && <p className="truncate text-[11px] text-zinc-400">{th.lead ? `${th.lead.companies?.name ?? ""} · ${th.lead.agent?.full_name ?? t("من غير أجنت")}` : t("مفيش ليد للرقم ده")}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`card ${selected ? "" : "hidden lg:block"}`}>
          {!selected ? (
            <Empty icon={MessageCircle}>{t("اختار محادثة من القايمة")}</Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 border-b border-(--glass-line) pb-3">
                <Link href={link({})} className="btn-ghost px-2.5 lg:hidden" aria-label={t("رجوع")}><ArrowRight size={17} className="ltr:rotate-180" /></Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{current?.lead?.full_name ?? current?.contact_name ?? selected}</p>
                  <p className="num text-xs text-zinc-500" dir="ltr">{selected}</p>
                </div>
              </div>
              {staff && current && !current.lead && (
                <StateForm action={waMakeLead} className="grid gap-2 rounded-xl bg-(--glass-strong) p-3 sm:grid-cols-3" submitLabel={t("اعمله ليد")}>
                  <input type="hidden" name="phone" value={selected} />
                  <input name="name" defaultValue={current.contact_name ?? ""} placeholder={t("الاسم")} className="input" />
                  <select name="company" required className="input sm:col-span-2" defaultValue="">
                    <option value="" disabled>{t("اختار الشركة")}</option>
                    {(companiesRes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </StateForm>
              )}
              <WaChat phone={selected} leadHref={current?.lead ? `${leadBase}${current.lead.id}` : undefined} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
