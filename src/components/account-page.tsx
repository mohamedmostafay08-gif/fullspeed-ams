import { KeyRound, Laptop, Smartphone, Trash2, UserRound } from "lucide-react";
import { changePassword } from "@/app/actions/account";
import { deletePasskey } from "@/app/actions/passkeys";
import { PageHeader } from "@/components/app-shell";
import { PasskeyRegisterButton } from "@/components/passkeys";
import { PrefsControls } from "@/components/prefs";
import { PushSettings } from "@/components/pwa";
import { StateForm } from "@/components/state-form";
import { formatDate } from "@/components/ui";
import { getT, getTheme } from "@/lib/i18n/server";
import { getPushPublicKey } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Profile } from "@/lib/types";

export async function AccountPage({ profile }: { profile: Profile }) {
  const [t, theme] = await Promise.all([getT(), getTheme()]);
  const supabase = await createClient();
  const [{ data: user }, { data: keys }, publicKey] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("passkeys").select("id, device_name, created_at, last_used_at").order("created_at"),
    getPushPublicKey(),
  ]);

  return (
    <>
      <PageHeader title={t("حسابي")} subtitle={t("الدخول بالبصمة، الإشعارات، وإعداداتك")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-600 text-xl font-bold text-white">
            {profile.full_name.split(/\s+/).slice(0, 2).map((x) => x[0]).join("")}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">{profile.full_name}</p>
            <p className="text-sm text-zinc-500">{t(ROLE_LABELS[profile.role])}</p>
            <p className="truncate text-sm text-zinc-500" dir="ltr">{user.user?.email}</p>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title"><UserRound size={18} className="text-zinc-500" /> {t("الإعدادات")}</h2>
          <PrefsControls theme={theme} sound />
        </section>

        <section className="card lg:col-span-2">
          <h2 className="card-title"><KeyRound size={18} className="text-brand-600" /> {t("الدخول بالبصمة / Face ID")}</h2>
          <p className="mb-4 text-sm text-zinc-500">{t("فعّلها على موبايلك وادخل بلمسة من غير كلمة سر. البصمة نفسها بتفضل على جهازك ومش بتتبعت لأي حد.")}</p>
          <PasskeyRegisterButton />
          <ul className="mt-4 divide-y divide-zinc-100">
            {(keys ?? []).length === 0 && <li className="py-3 text-sm text-zinc-400">{t("مفيش أجهزة متسجلة لسه")}</li>}
            {(keys ?? []).map((k) => {
              const Icon = /iphone|android|ipad/i.test(k.device_name ?? "") ? Smartphone : Laptop;
              return (
                <li key={k.id} className="flex items-center gap-3 py-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-zinc-100 text-zinc-600"><Icon size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{k.device_name ?? t("جهاز")}</p>
                    <p className="text-xs text-zinc-500">
                      {t("اتضاف")} {formatDate(k.created_at)}{k.last_used_at && <> · {t("آخر استخدام")} {formatDate(k.last_used_at)}</>}
                    </p>
                  </div>
                  <form action={deletePasskey}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className="rounded-lg p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t("حذف")} title={t("حذف")}><Trash2 size={16} /></button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="lg:col-span-2">
          <PushSettings publicKey={publicKey} />
        </div>

        <section className="card lg:col-span-2">
          <h2 className="card-title"><KeyRound size={18} className="text-zinc-500" /> {t("تغيير كلمة السر")}</h2>
          <StateForm action={changePassword} className="grid gap-3 sm:grid-cols-2" submitLabel={t("حفظ")} resetOnSuccess>
            <input name="password" type="password" minLength={8} required autoComplete="new-password" placeholder={t("كلمة السر الجديدة")} className="input" />
            <input name="confirm" type="password" minLength={8} required autoComplete="new-password" placeholder={t("اكتبها تاني")} className="input" />
          </StateForm>
        </section>
      </div>
    </>
  );
}
