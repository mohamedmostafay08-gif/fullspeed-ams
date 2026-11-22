import Link from "next/link";
import { Fingerprint, KeyRound, LogOut, MonitorSmartphone } from "lucide-react";
import { forceSignOutUser } from "@/app/actions/management";
import { PageHeader } from "@/components/app-shell";
import { Empty, formatDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { getT } from "@/lib/i18n/server";
import { hoursAgoIso } from "@/lib/time";

type Login = { id: number; user_id: string | null; at: string; method: "password" | "passkey"; ip: string | null; device: string | null; success: boolean; email: string | null };
type Person = { id: string; full_name: string; role: Role; is_active: boolean };
type Active = { user_id: string; sessions: number; last_active: string };

export default async function LoginsPage({ searchParams }: PageProps<"/admin/logins">) {
  const t = await getT();
  const me = await requireRole("admin");
  const sp = await searchParams;
  const who = typeof sp.user === "string" ? sp.user : "";
  const supabase = await createClient();

  let q = supabase.from("login_events").select("id, user_id, at, method, ip, device, success, email").order("at", { ascending: false }).limit(300);
  if (who) q = q.eq("user_id", who);
  const [loginsRes, peopleRes, activeRes] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name, role, is_active").order("full_name"),
    supabase.rpc("active_sessions"),
  ]);
  const logins = (loginsRes.data ?? []) as Login[];
  const people = (peopleRes.data ?? []) as Person[];
  const byId = new Map(people.map((p) => [p.id, p]));
  const active = ((activeRes.data ?? []) as Active[]).filter((a) => byId.has(a.user_id));
  const lastLogin = new Map<string, Login>();
  for (const l of logins) if (l.user_id && l.success && !lastLogin.has(l.user_id)) lastLogin.set(l.user_id, l);
  const since = hoursAgoIso(24);
  const failedToday = logins.filter((l) => !l.success && l.at >= since).length;

  return (
    <>
      <PageHeader title={t("سجل الدخول")} subtitle={t("مين دخل السيستم إمتى ومن أي جهاز — وتقدر تطلّع أي حد من كل أجهزته فوراً")}>
        <form className="flex items-center gap-2">
          <select name="user" defaultValue={who} className="input py-2 sm:w-56" aria-label={t("الموظف")}>
            <option value="">{t("كل الموظفين")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <button className="btn-ghost">{t("عرض")}</button>
        </form>
      </PageHeader>

      <section className="card">
        <h2 className="card-title"><MonitorSmartphone size={18} className="text-brand-600" /> {t("داخلين دلوقتي ({0})", active.length)}</h2>
        {active.length === 0 ? (
          <Empty icon={MonitorSmartphone}>{t("محدش داخل دلوقتي")}</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {active
              .sort((a, b) => b.last_active.localeCompare(a.last_active))
              .map((a) => {
                const p = byId.get(a.user_id)!;
                const last = lastLogin.get(a.user_id);
                return (
                  <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold">
                        <Link href={`/admin/logins?user=${p.id}`} className="hover:underline">{p.full_name}</Link>
                        <span className="ms-2 text-xs font-normal text-zinc-500">{t(ROLE_LABELS[p.role])}</span>
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t("{0} جهاز", a.sessions)} · {t("آخر نشاط")} {formatDate(a.last_active)}
                        {last?.device ? ` · ${last.device}` : ""}
                      </p>
                    </div>
                    {p.id !== me.id && (
                      <form action={forceSignOutUser}>
                        <input type="hidden" name="user_id" value={p.id} />
                        <button className="btn-ghost text-rose-600"><LogOut size={15} /> {t("طلّعه من كل الأجهزة")}</button>
                      </form>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <section className="card mt-6">
        <h2 className="card-title"><KeyRound size={18} className="text-zinc-500" /> {t("آخر مرات الدخول")}
          {failedToday > 0 && <span className="badge bg-rose-100 text-rose-700">{t("{0} محاولة فاشلة آخر 24 ساعة", failedToday)}</span>}
        </h2>
        {logins.length === 0 ? (
          <Empty>{t("لسه مفيش دخول متسجل")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>{t("الموظف")}</th><th>{t("إمتى")}</th><th>{t("الطريقة")}</th><th>{t("الجهاز")}</th><th>IP</th></tr></thead>
              <tbody>
                {logins.map((l) => (
                  <tr key={l.id}>
                    <td className="font-semibold">
                      {l.success ? (byId.get(l.user_id ?? "")?.full_name ?? "—") : (
                        <span className="flex flex-wrap items-center gap-2"><span className="badge bg-rose-100 text-rose-700">{t("محاولة فاشلة")}</span><span dir="ltr" className="text-xs font-normal text-zinc-500">{l.email}</span></span>
                      )}
                    </td>
                    <td className="text-xs text-zinc-500">{formatDate(l.at)}</td>
                    <td className="text-sm">
                      {l.method === "passkey" ? <span className="inline-flex items-center gap-1"><Fingerprint size={14} /> {t("بصمة")}</span> : t("كلمة السر")}
                    </td>
                    <td className="text-sm">{l.device ?? "—"}</td>
                    <td className="num text-xs text-zinc-500" dir="ltr">{l.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
