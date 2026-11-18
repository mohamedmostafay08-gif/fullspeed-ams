import Link from "next/link";
import { markAllRead } from "@/app/actions/notifications";
import { CompanyLogo, Empty, formatDate } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { NotificationType } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

const TYPE_STYLE: Record<NotificationType, { label: string; cls: string }> = {
  bonus: { label: "بونص", cls: "bg-emerald-100 text-emerald-800" },
  rate: { label: "تعريفة", cls: "bg-amber-100 text-amber-800" },
  task: { label: "تاسك", cls: "bg-indigo-100 text-indigo-800" },
  assignment: { label: "تعيين", cls: "bg-sky-100 text-sky-800" },
  lead: { label: "ليد", cls: "bg-violet-100 text-violet-800" },
  info: { label: "تنبيه", cls: "bg-zinc-200 text-zinc-700" },
  break: { label: "بريك", cls: "bg-teal-100 text-teal-800" },
  reminder: { label: "تذكير", cls: "bg-orange-100 text-orange-800" },
};

export async function NotificationsList({ userId }: { userId: string }) {
  const t = await getT();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, is_read, created_at, companies(name, logo_path)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  const items = data ?? [];
  const unread = items.some((n) => !n.is_read);

  return (
    <div className="space-y-3">
      {unread && (
        <form action={markAllRead}>
          <button className="btn-ghost">{t("تعليم الكل كمقروء")}</button>
        </form>
      )}
      {items.length === 0 && <Empty>{t("مفيش إشعارات")}</Empty>}
      {items.map((n) => {
        const company = n.companies as unknown as { name: string; logo_path: string | null } | null;
        const style = TYPE_STYLE[n.type as NotificationType];
        const body = (
          <div className={`card flex gap-3 ${n.is_read ? "" : "border-brand-500 bg-brand-50/40"}`}>
            {company ? <CompanyLogo name={company.name} src={company.logo_path} size={40} /> : <span className="size-10 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${style.cls}`}>{t(style.label)}</span>
                <p className="font-semibold">{t(n.title)}</p>
              </div>
              {n.body && <p className="mt-1 whitespace-pre-line text-sm text-zinc-600">{t(n.body)}</p>}
              <p className="mt-1 text-xs text-zinc-400">{formatDate(n.created_at)}</p>
            </div>
          </div>
        );
        return n.link ? (
          <Link key={n.id} href={n.link} className="block">{body}</Link>
        ) : (
          <div key={n.id}>{body}</div>
        );
      })}
    </div>
  );
}
