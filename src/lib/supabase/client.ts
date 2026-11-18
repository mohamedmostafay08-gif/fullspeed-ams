import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

/**
 * Subscribes with the signed-in user's token. Without it the socket joins as `anon`,
 * and RLS silently drops every postgres_changes event. Returns an unsubscribe function.
 */
export function subscribeAsUser(name: string, build: (channel: RealtimeChannel) => RealtimeChannel): () => void {
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  supabase.auth.getSession().then(async ({ data }) => {
    if (cancelled || !data.session) return;
    await supabase.realtime.setAuth(data.session.access_token);
    if (cancelled) return;
    channel = build(supabase.channel(name)).subscribe();
  });

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}

/**
 * Joins the team presence channel. Agents pass `meta` to announce themselves (only ids travel —
 * names are resolved server-side); watchers pass null and just receive the online set.
 */
export function joinPresence(key: string, meta: Record<string, unknown> | null, onSync: (onlineIds: Set<string>, state: Record<string, unknown[]>) => void): () => void {
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  supabase.auth.getSession().then(async ({ data }) => {
    if (cancelled || !data.session) return;
    await supabase.realtime.setAuth(data.session.access_token);
    if (cancelled) return;
    const ch = supabase.channel("presence:team", { config: { presence: { key } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as Record<string, unknown[]>;
      onSync(new Set(Object.keys(state)), state);
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED" && meta) await ch.track(meta);
    });
    channel = ch;
  });

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}
