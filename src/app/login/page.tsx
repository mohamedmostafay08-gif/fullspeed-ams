import Image from "next/image";
import { BrandMark } from "@/components/app-shell";
import { LoginForm } from "./login-form";
import { PrefsControls } from "@/components/prefs";
import { getT, getTheme } from "@/lib/i18n/server";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [t, theme] = await Promise.all([getT(), getTheme()]);
  const inactive = (await searchParams).e === "inactive";
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="flex flex-col justify-between px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight">Full Speed</p>
            <p className="text-xs font-medium text-zinc-500">Acquisition System</p>
          </div>
          <div className="ms-auto">
            <PrefsControls theme={theme} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-sm animate-rise py-12">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
            <span className="size-1.5 rounded-full bg-brand-500" /> {t("فريق الأكوزيشن")}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{t("أهلاً بيك تاني")}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{t("سجّل دخولك عشان تتابع شركاتك، الليدز، والتارجت بتاع النهارده.")}</p>
          {inactive && (
            <p role="alert" className="mt-6 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900">
              {t("حسابك مش مفعّل أو اتوقف — كلم الأدمن، أو ادخل بحساب تاني.")}
            </p>
          )}
          <LoginForm />
        </div>

        <p className="text-xs text-zinc-400">© {new Date().getFullYear()} Full Speed Logistics — The future of logistics</p>
      </section>

      <section className="relative hidden overflow-hidden bg-ink lg:block">
        <Image src="/brand/login-hero.jpg" alt="" fill priority sizes="55vw" className="object-cover object-top" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/70 to-transparent p-12 pt-40 text-bone">
          <p className="max-w-md text-2xl leading-relaxed font-bold">{t("كل ليد بيوصل لمكانه — من الإعلان للأجنت لحد ما الكابتن يستلم شغله.")}</p>
          <div className="mt-6 flex gap-8 text-sm text-slate-ink">
            <Stat value="27" label={t("شركة")} />
            <Stat value="27" label={t("محافظة")} />
            <Stat value="24/7" label={t("متابعة لحظية")} />
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="num text-2xl font-semibold text-white">{value}</p>
      <p className="mt-0.5">{label}</p>
    </div>
  );
}

