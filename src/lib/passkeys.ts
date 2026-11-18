import "server-only";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

const CHALLENGE_COOKIE = "fs_wa";
const CHALLENGE_TTL_MS = 5 * 60_000;

/** Relying party = the host the user is on (ams.fullspeedlogistics.com in production). */
export async function relyingParty() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

export async function saveChallenge(challenge: string, kind: "register" | "login", userId: string | null) {
  const db = createAdminClient();
  // Old challenges are useless; sweep them opportunistically.
  await db.from("webauthn_challenges").delete().lt("created_at", new Date(Date.now() - CHALLENGE_TTL_MS).toISOString());
  const { data } = await db.from("webauthn_challenges").insert({ challenge, kind, user_id: userId }).select("id").single();
  (await cookies()).set(CHALLENGE_COOKIE, data!.id, { httpOnly: true, sameSite: "strict", secure: true, maxAge: CHALLENGE_TTL_MS / 1000, path: "/" });
}

/** Returns and burns the pending challenge (single use). */
export async function takeChallenge(kind: "register" | "login", userId: string | null) {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete(CHALLENGE_COOKIE);
  if (!id) return null;
  const db = createAdminClient();
  const { data } = await db.from("webauthn_challenges").delete().eq("id", id).eq("kind", kind).select("challenge, user_id, created_at").maybeSingle();
  if (!data || Date.now() - new Date(data.created_at).getTime() > CHALLENGE_TTL_MS) return null;
  if (userId && data.user_id !== userId) return null;
  return data.challenge as string;
}

export const toB64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
export const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** Friendly device label from the user agent ("iPhone", "Android", "Windows"…). */
export function deviceLabel(ua: string) {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Device";
}
