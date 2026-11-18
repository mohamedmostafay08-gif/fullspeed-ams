"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getProfile } from "@/lib/auth";
import { deviceLabel, fromB64u, relyingParty, saveChallenge, takeChallenge, toB64u } from "@/lib/passkeys";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

// ───────── Register this device (signed in) ─────────
export async function startPasskeyRegistration() {
  const profile = await getProfile();
  if (!profile) return fail("سجّل دخول الأول");
  if (!hasServiceKey()) return fail("حصلت مشكلة، جرّب تاني");
  const { rpID } = await relyingParty();
  const supabase = await createClient();
  const [{ data: user }, { data: existing }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("passkeys").select("id, transports").eq("user_id", profile.id),
  ]);
  const options = await generateRegistrationOptions({
    rpName: "Full Speed",
    rpID,
    userName: user.user?.email ?? profile.full_name,
    userDisplayName: profile.full_name,
    userID: new TextEncoder().encode(profile.id),
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({ id: c.id, transports: c.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
  });
  await saveChallenge(options.challenge, "register", profile.id);
  return { ok: true as const, options };
}

export async function finishPasskeyRegistration(response: RegistrationResponseJSON): Promise<Result> {
  const profile = await getProfile();
  if (!profile) return fail("سجّل دخول الأول");
  const challenge = await takeChallenge("register", profile.id);
  if (!challenge) return fail("الطلب خلص وقته — جرّب تاني");
  const { rpID, origin } = await relyingParty();
  try {
    const v = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    if (!v.verified || !v.registrationInfo) return fail("مقدرتش أتأكد من البصمة");
    const { credential } = v.registrationInfo;
    const { error } = await createAdminClient().from("passkeys").insert({
      id: credential.id,
      user_id: profile.id,
      public_key: toB64u(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      device_name: deviceLabel((await headers()).get("user-agent") ?? ""),
    });
    if (error) return fail(error.code === "23505" ? "الجهاز ده متسجل بالفعل" : "مقدرتش أحفظ");
  } catch {
    return fail("مقدرتش أتأكد من البصمة");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deletePasskey(form: FormData) {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  await supabase.from("passkeys").delete().eq("id", String(form.get("id") ?? "")).eq("user_id", profile.id);
  revalidatePath("/", "layout");
}

// ───────── Sign in with a passkey (signed out) ─────────
export async function startPasskeyLogin() {
  if (!hasServiceKey()) return fail("الدخول بالبصمة مش متاح دلوقتي");
  const { rpID } = await relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
  await saveChallenge(options.challenge, "login", null);
  return { ok: true as const, options };
}

export async function finishPasskeyLogin(response: AuthenticationResponseJSON): Promise<Result<{ to: string }>> {
  const challenge = await takeChallenge("login", null);
  if (!challenge) return fail("الطلب خلص وقته — جرّب تاني");
  const db = createAdminClient();
  const { data: key } = await db.from("passkeys").select("id, user_id, public_key, counter, transports").eq("id", response.id).maybeSingle();
  if (!key) return fail("البصمة دي مش متسجلة — ادخل بالإيميل الأول وفعّلها من «حسابي»");
  const { rpID, origin } = await relyingParty();
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: key.id, publicKey: fromB64u(key.public_key), counter: Number(key.counter), transports: key.transports as AuthenticatorTransportFuture[] },
    });
    if (!v.verified) return fail("مقدرتش أتأكد من البصمة");
    await db.from("passkeys").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", key.id);
  } catch {
    return fail("مقدرتش أتأكد من البصمة");
  }

  const { data: profile } = await db.from("profiles").select("is_active").eq("id", key.user_id).maybeSingle();
  if (!profile?.is_active) return fail("الحساب ده مش مفعّل — كلم الأدمن");
  const { data: user } = await db.auth.admin.getUserById(key.user_id);
  if (!user.user?.email) return fail("حصلت مشكلة، جرّب تاني");

  // Mint a one-time sign-in token server-side and redeem it straight away (nothing is emailed).
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
  if (error || !link.properties?.hashed_token) return fail("حصلت مشكلة، جرّب تاني");
  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpError) return fail("حصلت مشكلة، جرّب تاني");
  return { ok: true, to: "/" };
}
