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
