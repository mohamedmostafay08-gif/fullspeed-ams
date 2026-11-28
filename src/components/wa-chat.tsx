import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { WaComposer } from "@/components/wa-composer";
import { WaLive } from "@/components/wa-live";
import { Empty } from "@/components/ui";
import { getConfig } from "@/lib/app-config";
import { getLocale, getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cairoDateTime } from "@/lib/time";

type Msg = { id: string; direction: "in" | "out"; kind: string; body: string | null; media_id: string | null; status: string | null; error: string | null; created_at: string };

const TICKS: Record<string, string> = { sent: "✓", delivered: "✓✓", read: "✓✓", failed: "⚠️" };
const KIND_LABEL: Record<string, string> = { image: "📷 صورة", video: "🎬 فيديو", audio: "🎙️ رسالة صوتية", document: "📎 ملف", sticker: "🙂 ستيكر", template: "📨 قالب" };

/** One WhatsApp conversation: bubbles oldest → newest, receipts, media, and the reply box. */
export async function WaChat({ phone, compact = false, leadHref }: { phone: string; compact?: boolean; leadHref?: string }) {
  const [t, locale, cfg] = await Promise.all([getT(), getLocale(), getConfig()]);
  const supabase = await createClient();
  const [{ data: rows }, { data: thread }] = await Promise.all([
    supabase.from("wa_messages").select("id, direction, kind, body, media_id, status, error, created_at").eq("phone", phone).order("created_at", { ascending: false }).limit(compact ? 30 : 200),
    supabase.from("wa_threads").select("last_inbound_at, unread").eq("phone", phone).maybeSingle(),
  ]);
  if (thread?.unread) await supabase.rpc("wa_mark_read", { p_phone: phone });
  const msgs = ((rows ?? []) as Msg[]).reverse();
  const open = !!thread?.last_inbound_at && new Date().getTime() - Date.parse(thread.last_inbound_at) < 24 * 3600_000;
  const configured = Boolean(cfg.wa_phone_id && cfg.wa_token);

  return (
    <div className="space-y-3">
      <WaLive channel={`chat-${phone}`} phone={phone} />
      {msgs.length === 0 ? (
        <Empty icon={MessageCircle}>{t("مفيش رسايل واتساب مع الرقم ده لسه")}</Empty>
      ) : (
        <ol className={`flex flex-col gap-2 overflow-y-auto rounded-2xl bg-(--glass-strong) p-3 ${compact ? "max-h-80" : "max-h-[60vh]"}`}>
          {msgs.map((m) => {
            const mine = m.direction === "out";
            return (
              <li key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? "self-end rounded-ee-sm bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50" : "self-start rounded-es-sm bg-white dark:bg-zinc-800"}`}>
                {m.media_id && m.kind === "image" ? (
                  <a href={`/api/wa/media/${m.media_id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/wa/media/${m.media_id}`} alt={t("صورة")} loading="lazy" className="mb-1 max-h-56 rounded-xl" />
                  </a>
                ) : m.media_id ? (
                  <a href={`/api/wa/media/${m.media_id}`} target="_blank" rel="noreferrer" className="mb-1 block font-semibold underline">{t(KIND_LABEL[m.kind] ?? "📎 ملف")}</a>
                ) : KIND_LABEL[m.kind] && !m.body ? (
                  <p className="font-semibold">{t(KIND_LABEL[m.kind])}</p>
                ) : null}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-500">
                  {cairoDateTime(m.created_at, locale)}
                  {mine && m.status && <span className={m.status === "read" ? "text-sky-600" : m.status === "failed" ? "text-rose-600" : ""} title={m.error ?? m.status}>{TICKS[m.status] ?? ""}</span>}
                </p>
                {mine && m.status === "failed" && m.error && <p className="text-[11px] text-rose-600">{m.error}</p>}
              </li>
            );
          })}
        </ol>
      )}
      <WaComposer phone={phone} open={open} configured={configured} />
      {leadHref && <Link href={leadHref} className="text-xs font-semibold text-brand-700 hover:underline">{t("افتح صفحة الليد ←")}</Link>}
    </div>
  );
}
