import { PageHeader } from "@/components/app-shell";
import { CompanyLogo } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getCompanies } from "@/lib/data";

const SAMPLE = `POST /api/crm/leads
x-api-key: <CRM_WEBHOOK_SECRET>
Content-Type: application/json

[
  {
    "external_id": "CRM-10234",
    "name": "محمد أحمد",
    "phone": "01012345678",
    "company": "talabat",
    "governorate": "القاهرة",
    "region": "مدينة نصر",
    "source": "facebook",
    "fields": { "vehicle": "موتوسيكل", "age": 24 }
  }
]`;

const PULL = `GET /api/crm/leads?since=2026-11-18T00:00:00Z
x-api-key: <CRM_WEBHOOK_SECRET>`;

export default async function CrmPage() {
  await requireRole("admin");
  const companies = await getCompanies(true);
  const configured = (process.env.CRM_WEBHOOK_SECRET ?? "").length >= 24;

  return (
    <>
      <PageHeader title="ربط الـ CRM" subtitle="الليدز تدخل السيستم أوتوماتيك وتتوزع على الأجنتس، والحالات ترجع للـ CRM" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 text-sm leading-7">
          <p className={`badge ${configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {configured ? "المفتاح متظبط" : "لسه محتاج CRM_WEBHOOK_SECRET في إعدادات السيرفر"}
          </p>
          <h2 className="text-base font-semibold">1) استقبال الليدز (CRM ← السيستم)</h2>
          <p>
            الـ CRM يبعت كل ليد جديد على الرابط ده. السيستم بيتأكد إن الرقم مش مكرر على نفس الشركة، وبعدين بيوزّعه أوتوماتيك على الأجنت
            المتعين على الشركة اللي عنده أقل عدد ليدز النهارده، والأجنت بيوصله إشعار فوري.
          </p>
          <pre dir="ltr" className="overflow-x-auto rounded-lg bg-ink p-3 text-left text-xs text-zinc-100">{SAMPLE}</pre>
          <h2 className="text-base font-semibold">2) رجوع الحالات (السيستم ← CRM)</h2>
          <p>الـ CRM يسحب كل الليدز اللي حالتها اتغيرت من وقت معين (مثلاً كل 10 دقايق) عشان يعرف مين اشتغل ومين اترفض.</p>
          <pre dir="ltr" className="overflow-x-auto rounded-lg bg-ink p-3 text-left text-xs text-zinc-100">{PULL}</pre>
          <p className="text-zinc-500">
            لو الـ CRM مفيهوش Webhooks أو API: صدّر الليدز Excel → احفظها CSV → ارفعها من صفحة الليدز وهتتوزع بنفس الطريقة.
          </p>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">أكواد الشركات (قيمة company)</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {companies.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <CompanyLogo name={c.name} src={c.logo_path} size={24} />
                <span className="flex-1">{c.name}</span>
                <code dir="ltr" className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{c.slug}</code>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
