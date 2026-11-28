import Link from "next/link";
import { Eye, Search } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Empty } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Row = { id: string; full_name: string; phone: string | null; is_active: boolean; team: { name: string } | null };

/** Pick an agent and open their pages read-only, without signing out. */
export default async function ViewAsPage({ searchParams }: PageProps<"/admin/view-as">) {
  const t = await getT();
  await requireRole("admin");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";
  const error = typeof sp.e === "string" ? sp.e.slice(0, 200) : "";
  const supabase = await createClient();
  const { data, error: loadError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, is_active, team:teams(name)")
    .eq("role", "agent")
    .order("is_active", { ascending: false })
    .order("full_name");
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !q || r.full_name.includes(q) || (r.phone ?? "").includes(q));

  return (
    <>
      <PageHeader title={`👀 ${t("شوف كأجنت")}`} subtitle={t("افتح السيستم زي ما الأجنت شايفه بالظبط، من غير ما تعمل خروج ودخول. عرض بس، ومفيش أي تعديل بيتحفظ.")} />

      {(error || loadError) && (
        <p role="alert" className="mx-auto mb-5 max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-semibold text-rose-700">
          ⚠️ {t(error || loadError!.message)}
        </p>
      )}

      <form className="relative mx-auto mb-6 max-w-md">
        <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input name="q" defaultValue={q} placeholder={t("دوّر بالاسم أو الرقم")} className="input ps-9 text-center" />
      </form>

      {rows.length === 0 ? (
        <section className="card mx-auto max-w-3xl"><Empty icon={Eye}>{t("مفيش أجنتس")}</Empty></section>
      ) : (
        <ul className="stagger mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id} className={`card flex flex-col items-center gap-3 p-5 text-center ${r.is_active ? "" : "opacity-60"}`}>
              <span className="grid size-12 place-items-center rounded-full bg-violet-100 text-xl">🧑‍💼</span>
              <div className="min-w-0">
                <Link href={`/admin/agents/${r.id}`} className="font-bold hover:underline">{r.full_name}</Link>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {r.team?.name ?? t("من غير تيم")}
                  {r.is_active ? "" : ` · ${t("موقوف")}`}
                </p>
              </div>
              <form action="/api/view-as" method="post" className="w-full">
                <input type="hidden" name="agent" value={r.id} />
                <button className="btn-primary w-full justify-center">👀 {t("شوف بعينه")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
