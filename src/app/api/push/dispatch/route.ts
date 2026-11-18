import webpush from "web-push";
import { getPushConfig, secretMatches } from "@/lib/push";
import { makeT, type Locale } from "@/lib/i18n/translate";
import { createAdminClient } from "@/lib/supabase/admin";

const URGENT = new Set(["bonus", "rate", "reminder", "lead", "assignment"]);

/** Called by the database (pg_net) for each new notification; fans it out to the user's devices. */
export async function POST(request: Request) {
  const cfg = await getPushConfig();
  if (!cfg) return Response.json({ error: "push not configured" }, { status: 503 });
  if (!secretMatches(request.headers.get("x-dispatch-secret"), cfg.dispatchSecret)) return Response.json({ error: "forbidden" }, { status: 403 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  const db = createAdminClient();
  const { data: n } = await db.from("notifications").select("id, user_id, type, title, body, link").eq("id", id).maybeSingle();
  if (!n) return Response.json({ sent: 0 });
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, locale").eq("user_id", n.user_id);

  // VAPID "subject" must be an https: URL; local runs are plain http.
  const origin = new URL(request.url).origin;
  webpush.setVapidDetails(origin.startsWith("https://") ? origin : "https://ams.fullspeedlogistics.com", cfg.publicKey, cfg.privateKey);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      const t = makeT(s.locale as Locale);
      const payload = JSON.stringify({
        title: t(n.title),
        body: n.body ? t(n.body) : "",
        url: n.link || "/",
        tag: n.id,
        type: n.type,
        lang: s.locale,
        dir: s.locale === "ar" ? "rtl" : "ltr",
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 6 * 3600,
          urgency: URGENT.has(n.type) ? "high" : "normal",
        });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id);
      }
    }),
  );
  if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);
  if (sent) await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("user_id", n.user_id).not("id", "in", `(${gone.join(",") || "00000000-0000-0000-0000-000000000000"})`);
  return Response.json({ sent, removed: gone.length });
}
