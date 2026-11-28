import Link from "next/link";
import { Bookmark, X } from "lucide-react";
import { deleteFilter, saveFilter } from "@/app/actions/filters";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/action-form";

/** Named filters a person saved on this page, plus a box to save the current one. */
export async function SavedFilters({ page, path, query }: { page: "leads" | "analytics"; path: string; query: string }) {
  const t = await getT();
  const supabase = await createClient();
  const { data } = await supabase.from("saved_filters").select("id, name, query").eq("page", page).order("created_at");
  const saved = (data ?? []) as { id: string; name: string; query: string }[];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bookmark size={16} className="text-brand-600" aria-hidden />
      {saved.length === 0 && <span className="text-xs text-zinc-500">{t("مفيش فلاتر محفوظة")}</span>}
      {saved.map((s) => (
        <span key={s.id} className={`chip gap-1 ${s.query === query ? "chip-active" : ""}`}>
          <Link href={`${path}?${s.query}`}>{s.name}</Link>
          <ActionForm action={deleteFilter}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="path" value={path} />
            <button aria-label={t("امسح")} className="opacity-60 hover:opacity-100"><X size={12} /></button>
          </ActionForm>
        </span>
      ))}
      {query && (
        <ActionForm action={saveFilter} className="ms-auto flex items-center gap-1">
          <input type="hidden" name="page" value={page} />
          <input type="hidden" name="path" value={path} />
          <input type="hidden" name="query" value={query} />
          <input name="name" required maxLength={60} placeholder={t("اسم الفلتر ده")} className="input w-40 py-1.5 text-sm" />
          <button className="btn-ghost btn-sm">{t("احفظ الفلتر")}</button>
        </ActionForm>
      )}
    </div>
  );
}
