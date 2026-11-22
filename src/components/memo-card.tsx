import { Megaphone } from "lucide-react";
import { formatDate } from "@/components/ui";
import type { Memo } from "@/lib/memos";
import { getT } from "@/lib/i18n/server";
import { teamLabel } from "@/lib/types";

export async function MemoCard({ memo, isNew, children }: { memo: Memo; isNew?: boolean; children?: React.ReactNode }) {
  const t = await getT();
  return (
    <article className={`card ${isNew ? "ring-2 ring-brand-500/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Megaphone size={18} className="shrink-0 text-brand-600" /> {memo.title}
          {isNew && <span className="badge bg-brand-100 text-brand-700">{t("جديد")}</span>}
        </h3>
        <span className="badge bg-zinc-100 text-zinc-600">{memo.team ? teamLabel(memo.team.name, t) : t("للكل")}</span>
      </div>
      <p className="mt-2 whitespace-pre-line leading-7 text-zinc-700">{memo.body}</p>
      <p className="mt-3 text-xs text-zinc-500">{memo.author?.full_name ?? t("الإدارة")} · {formatDate(memo.created_at)}</p>
      {children}
    </article>
  );
}
