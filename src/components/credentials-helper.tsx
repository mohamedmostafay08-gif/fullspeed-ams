"use client";

import { useRef } from "react";
import { KeyRound, MessageCircle } from "lucide-react";
import { useT } from "@/lib/i18n/client";

const CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function strongPassword(len = 10) {
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}

/** Egyptian mobile → wa.me digits (01xxxxxxxxx → 201xxxxxxxxx). */
function waDigits(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) return `2${d}`;
  return d;
}

/**
 * Two buttons inside a user form: fill the password field with a strong one, and open WhatsApp with
 * the sign-in details (name, e-mail, password, link) typed in the same form.
 */
export function CredentialsHelper({ passwordField = "password" }: { passwordField?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const field = (name: string) => ref.current?.closest("form")?.querySelector<HTMLInputElement>(`[name="${name}"]`) ?? null;

  const generate = () => {
    const el = field(passwordField);
    if (!el) return;
    el.value = strongPassword();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const sendWhatsApp = () => {
    const name = field("full_name")?.value.trim() ?? "";
    const email = field("email")?.value.trim() ?? "";
    const password = field(passwordField)?.value ?? "";
    const phone = field("phone")?.value ?? "";
    const lines = [
      t("أهلاً {0} 👋", name),
      t("ده حسابك على سيستم Full Speed:"),
      `🔗 ${window.location.origin}/login`,
      `📧 ${email}`,
      password ? `🔑 ${password}` : "",
      t("غيّر كلمة السر بعد أول دخول."),
    ].filter(Boolean);
    const to = waDigits(phone);
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
  };

  return (
    <div ref={ref} className="flex flex-wrap gap-2 sm:col-span-full">
      <button type="button" onClick={generate} className="btn-ghost text-sm"><KeyRound size={15} /> {t("ولّد كلمة سر قوية")}</button>
      <button type="button" onClick={sendWhatsApp} className="btn-ghost text-sm text-emerald-700"><MessageCircle size={15} /> {t("ابعت بيانات الدخول واتساب")}</button>
    </div>
  );
}
