import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Memo = {
  id: string;
  title: string;
  body: string;
  team_id: string | null;
  created_by: string;
  created_at: string;
  author: { full_name: string } | null;
  team: { name: string } | null;
};

/** The memos this user can see (newest first), marking the ones addressed to them as read. */
export async function loadMemosAndMarkRead(userId: string, limit = 50) {
  const supabase = await createClient();
  const [{ data }, { data: reads }] = await Promise.all([
    supabase
      .from("broadcasts")
      .select("id, title, body, team_id, created_by, created_at, author:profiles!broadcasts_created_by_fkey(full_name), team:teams(name)")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.from("broadcast_reads").select("broadcast_id").eq("user_id", userId),
  ]);
  const memos = (data ?? []) as unknown as Memo[];
  const readIds = new Set((reads ?? []).map((r) => r.broadcast_id));
  const unread = memos.filter((m) => m.created_by !== userId && !readIds.has(m.id)).map((m) => m.id);
  if (unread.length) await supabase.from("broadcast_reads").insert(unread.map((id) => ({ broadcast_id: id, user_id: userId })));
  return { memos, unread: new Set(unread) };
}
