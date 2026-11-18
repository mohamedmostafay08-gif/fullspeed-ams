import { Ban, Trash2 } from "lucide-react";
import { addToBlacklist, removeFromBlacklist } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty, formatDate } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function BlacklistPage({ searchParams }: PageProps<"/admin/blacklist">) {
  const t = await getT();
  await requireRole(...STAFF);
  const q = String((await searchParams).q ?? "").replace(/[%,()*\\]/g, "").trim().slice(0, 40);
  const supabase = await createClient();
  let query = supabase
    .from("blacklist")
    .select("id, phone, full_name, reason, created_at, by:profiles(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) query = query.or(`phone.ilike.%${q}%,full_name.ilike.%${q}%`);
  const { data, count } = await query;

  return (
    <>
      <PageHeader title={t("البلاك ليست")} subtitle={t("{0} رقم محظور — مش هيتسجلوا تاني من أي مكان (فورم، ملف، CRM)", count ?? 0)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card h-fit">
          <h2 className="card-title"><Ban size={18} className="text-rose-600" /> {t("حظر رقم")}</h2>
          <StateForm action={addToBlacklist} className="space-y-3" submitLabel={t("احظر الرقم")} resetOnSuccess>
            <input name="phone" required inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" className="input text-left rtl:text-right" aria-label={t("رقم الموبايل")} />
            <input name="full_name" placeholder={t("الاسم (اختياري)")} className="input" />
            <input name="reason" required maxLength={300} placeholder={t("السبب (مثلاً: نصب / بيانات مزورة)")} className="input" />
          </StateForm>
        </section>
        <section className="card lg:col-span-2">
          <form className="mb-4 flex gap-2">
            <input name="q" defaultValue={q} placeholder={t("اسم أو موبايل")} className="input" />
            <button className="btn-ghost">{t("فلتر")}</button>
          </form>
          {(data ?? []).length === 0 ? (
            <Empty icon={Ban}>{t("مفيش أرقام محظورة")}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>{t("الرقم")}</th><th>{t("الاسم")}</th><th>{t("السبب")}</th><th>{t("بواسطة")}</th><th className="w-10" /></tr>
                </thead>
                <tbody>
                  {(data ?? []).map((b) => (
                    <tr key={b.id}>
                      <td><span dir="ltr" className="num font-semibold">{b.phone}</span></td>
                      <td>{b.full_name ?? "—"}</td>
                      <td className="text-rose-700">{b.reason}</td>
                      <td className="text-xs text-zinc-500">{(b.by as unknown as { full_name: string } | null)?.full_name ?? "—"}<br />{formatDate(b.created_at)}</td>
                      <td>
                        <form action={removeFromBlacklist}>
                          <input type="hidden" name="id" value={b.id} />
                          <button className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-ink" aria-label={t("شيل من البلاك ليست")} title={t("شيل من البلاك ليست")}><Trash2 size={15} /></button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
