import { Megaphone, Send, Trash2 } from "lucide-react";
import { deleteMemo, postMemo } from "@/app/actions/management";
import { PageHeader } from "@/components/app-shell";
import { MemoCard } from "@/components/memo-card";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { MANAGERS, STAFF, requireRole } from "@/lib/auth";
import { loadMemosAndMarkRead } from "@/lib/memos";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Reader = { user_id: string; full_name: string; read_at: string | null };

export default async function MemosPage() {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const isManager = MANAGERS.includes(me.role);
  const supabase = await createClient();
  const [{ memos, unread }, teamsRes] = await Promise.all([
    loadMemosAndMarkRead(me.id, 30),
    supabase.from("teams").select("id, name").order("name"),
  ]);
  const audiences = await Promise.all(
    memos.map((m) => supabase.rpc("broadcast_audience", { p_id: m.id }).then((r) => (r.data ?? []) as Reader[])),
  );
  const myTeam = (teamsRes.data ?? []).find((x) => x.id === me.team_id);

  return (
    <>
      <PageHeader title={t("التعميمات")} subtitle={t("رسالة توصل للفريق كله أو لتيم معين، بإشعار على الموبايل، وتعرف مين قراها")} />

      <section className="card">
        <h2 className="card-title"><Send size={18} className="text-brand-600" /> {t("تعميم جديد")}</h2>
        {me.role === "team_leader" && !me.team_id ? (
          <p className="text-sm text-zinc-500">{t("إنت مش متعين على تيم")}</p>
        ) : (
          <StateForm action={postMemo} submitLabel={t("ابعت التعميم")} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="title">{t("العنوان")}</label>
              <input id="title" name="title" required minLength={2} maxLength={150} className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="body">{t("الرسالة")}</label>
              <textarea id="body" name="body" required minLength={2} maxLength={4000} rows={4} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="team_id">{t("لمين؟")}</label>
              {isManager ? (
                <select id="team_id" name="team_id" className="input" defaultValue="">
                  <option value="">{t("الفريق كله")}</option>
                  {(teamsRes.data ?? []).map((x) => <option key={x.id} value={x.id}>{t("تيم {0}", x.name)}</option>)}
                </select>
              ) : (
                <p className="input bg-zinc-50">{t("تيم {0}", myTeam?.name ?? "")}</p>
              )}
            </div>
          </StateForm>
        )}
      </section>

      <div className="mt-6 grid gap-4">
        {memos.length === 0 ? (
          <section className="card"><Empty icon={Megaphone}>{t("لسه مفيش تعميمات")}</Empty></section>
        ) : (
          memos.map((m, i) => {
            const readers = audiences[i];
            const done = readers.filter((r) => r.read_at).length;
            const pending = readers.filter((r) => !r.read_at);
            return (
              <MemoCard key={m.id} memo={m} isNew={unread.has(m.id)}>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold text-zinc-700">
                      {t("قراه {0} من {1}", done, readers.length)}
                    </summary>
                    {pending.length > 0 && (
                      <p className="mt-2 text-zinc-500">{t("لسه مقرهوش:")} {pending.map((r) => r.full_name).join("، ")}</p>
                    )}
                  </details>
                  {(m.created_by === me.id || me.role === "admin") && (
                    <form action={deleteMemo}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn-ghost px-2.5 text-rose-600" aria-label={t("حذف")}><Trash2 size={15} /></button>
                    </form>
                  )}
                </div>
              </MemoCard>
            );
          })
        )}
      </div>
    </>
  );
}
