import { createAnnouncement, sendMessage } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { CompanyLogo, Empty, formatDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const ANN_LABEL: Record<string, string> = { bonus: "بونص", rate: "تعريفة", info: "معلومة" };

export default async function AnnouncementsPage() {
  await requireRole("admin", "team_leader");
  const supabase = await createClient();
  const [companies, { data: anns }, { data: people }] = await Promise.all([
    getCompanies(true),
    supabase
      .from("company_announcements")
      .select("id, type, title, body, amount, valid_to, created_at, companies(name, logo_path)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
  ]);

  return (
    <>
      <PageHeader title="البونص والإشعارات" subtitle="أي بونص أو تعريفة بتتنشر لشركة بتوصل فوراً لكل الأجنتس المتعينين عليها" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-3 font-semibold">بونص / تعريفة لشركة</h2>
            <StateForm action={createAnnouncement} className="space-y-3" submitLabel="نشر" resetOnSuccess>
              <select name="company_id" required className="input">
                <option value="">الشركة</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select name="type" className="input">
                <option value="bonus">بونص</option>
                <option value="rate">تعريفة جديدة</option>
                <option value="info">معلومة / تحديث</option>
              </select>
              <input name="title" required placeholder="العنوان" className="input" />
              <textarea name="body" rows={3} placeholder="التفاصيل والشروط" className="input" />
              <div className="grid grid-cols-2 gap-2">
                <input name="amount" type="number" step="0.01" placeholder="المبلغ (ج.م)" className="input" />
                <input name="valid_to" type="date" className="input" aria-label="ساري حتى" />
              </div>
            </StateForm>
          </section>

          <section className="card">
            <h2 className="mb-3 font-semibold">رسالة مباشرة</h2>
            <StateForm action={sendMessage} className="space-y-3" submitLabel="إرسال" resetOnSuccess>
              <input name="title" required placeholder="الرسالة" className="input" />
              <textarea name="body" rows={2} placeholder="تفاصيل (اختياري)" className="input" />
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
                {(people ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="user_id" value={p.id} className="accent-brand-600" /> {p.full_name}
                  </label>
                ))}
              </div>
            </StateForm>
          </section>
        </div>

        <section className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">آخر الإعلانات</h2>
          {(anns ?? []).length === 0 ? (
            <Empty>لسه مفيش</Empty>
          ) : (
            <ul className="space-y-3">
              {(anns ?? []).map((a) => {
                const c = a.companies as unknown as { name: string; logo_path: string | null };
                return (
                  <li key={a.id} className="flex gap-3 rounded-xl border border-zinc-200 p-3">
                    <CompanyLogo name={c.name} src={c.logo_path} size={40} />
                    <div>
                      <p className="font-semibold">
                        <span className="text-brand-700">{ANN_LABEL[a.type]} — {c.name}:</span> {a.title}
                        {a.amount != null && ` (${a.amount} ج.م)`}
                      </p>
                      {a.body && <p className="text-sm text-zinc-600">{a.body}</p>}
                      <p className="text-xs text-zinc-400">{formatDate(a.created_at)}{a.valid_to && ` · لحد ${a.valid_to}`}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
