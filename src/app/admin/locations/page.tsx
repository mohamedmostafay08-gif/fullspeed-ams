import { ExternalLink, MapPin, Trash2, Users } from "lucide-react";
import { createLocation, deleteLocation, updateLocationRadius } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { MANAGERS, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function LocationsPage() {
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  const [{ data: locations }, { data: people }] = await Promise.all([
    supabase.from("work_locations").select("id, name, lat, lng, radius_m").order("name"),
    supabase.from("profiles").select("id, full_name, role, location_id, allow_anywhere").in("role", ["agent", "team_leader"]).eq("is_active", true),
  ]);
  const byLocation = new Map<string, { id: string; full_name: string; allow_anywhere: boolean }[]>();
  for (const p of people ?? []) {
    if (!p.location_id) continue;
    byLocation.set(p.location_id, [...(byLocation.get(p.location_id) ?? []), p]);
  }
  const unassigned = (people ?? []).filter((p) => !p.location_id);

  return (
    <>
      <PageHeader
        title="أماكن الشغل"
        subtitle="الأجنت المربوط بمكان مش هيفتح معاه السيستم غير وهو جوه نطاقه — إلا لو فتحتله «من أي مكان» من صفحته"
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <section className="card h-fit">
          <h2 className="card-title"><MapPin size={18} className="text-brand-600" /> إضافة مكان</h2>
          <StateForm action={createLocation} className="space-y-3" submitLabel="إضافة" resetOnSuccess>
            <div>
              <label className="label" htmlFor="name">اسم المكان</label>
              <input id="name" name="name" required placeholder="مصر الجديدة" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="location">اللوكيشن</label>
              <input
                id="location"
                name="location"
                required
                dir="ltr"
                placeholder="https://maps.app.goo.gl/...   or   30.0911, 31.3220"
                className="input text-left"
              />
              <p className="mt-1 text-xs text-zinc-500">من جوجل ماب: افتح المكان ← Share ← Copy link، والصقه هنا.</p>
            </div>
            <div>
              <label className="label" htmlFor="radius_m">النطاق المسموح (متر)</label>
              <input id="radius_m" name="radius_m" type="number" min={50} max={5000} defaultValue={300} className="input" />
            </div>
          </StateForm>
        </section>

        <section className="space-y-4 xl:col-span-2">
          {(locations ?? []).length === 0 ? (
            <Empty icon={MapPin}>لسه مفيش أماكن — ضيف مصر الجديدة والمهندسين</Empty>
          ) : (
            (locations ?? []).map((l) => {
              const team = byLocation.get(l.id) ?? [];
              return (
                <article key={l.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{l.name}</h3>
                      <a
                        href={`https://www.google.com/maps?q=${l.lat},${l.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="num inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                        dir="ltr"
                      >
                        {l.lat.toFixed(5)}, {l.lng.toFixed(5)} <ExternalLink size={12} />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <form action={updateLocationRadius} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={l.id} />
                        <input name="radius_m" type="number" min={50} max={5000} defaultValue={l.radius_m} className="input w-24 py-1.5" aria-label="النطاق بالمتر" />
                        <span className="text-xs text-zinc-500">متر</span>
                        <button className="btn-ghost btn-sm">حفظ</button>
                      </form>
                      <form action={deleteLocation}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="btn-danger btn-sm" aria-label={`حذف ${l.name}`}><Trash2 size={14} /></button>
                      </form>
                    </div>
                  </div>
                  <p className="mt-4 mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
                    <Users size={14} /> المربوطين بالمكان ده ({team.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {team.length === 0 ? (
                      <span className="text-sm text-zinc-400">محدش — اربط الناس من صفحة كل أجنت</span>
                    ) : (
                      team.map((p) => (
                        <span key={p.id} className={`chip ${p.allow_anywhere ? "border-amber-300 bg-amber-50 text-amber-800" : ""}`}>
                          {p.full_name}
                          {p.allow_anywhere && " · من أي مكان"}
                        </span>
                      ))
                    )}
                  </div>
                </article>
              );
            })
          )}
          {unassigned.length > 0 && (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm leading-6 text-zinc-500">
              <b className="text-ink">{unassigned.length}</b> من الفريق مش مربوطين بمكان — دول بيفتحوا من أي مكان لحد ما تربطهم:{" "}
              {unassigned.map((p) => p.full_name).join("، ")}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
