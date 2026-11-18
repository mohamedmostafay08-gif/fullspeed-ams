import { FileText, Paperclip, Trash2 } from "lucide-react";
import { deleteDocument } from "@/app/actions/leads";
import { DocUploader } from "@/components/doc-uploader";
import { Empty, formatDate } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { DOC_KINDS } from "@/lib/types";

export async function LeadDocuments({ leadId, userId, staff }: { leadId: string; userId: string; staff: boolean }) {
  const t = await getT();
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_documents")
    .select("id, kind, path, file_name, mime, size, uploaded_by, created_at, uploader:profiles(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  const docs = data ?? [];
  const { data: signed } = docs.length
    ? await supabase.storage.from("lead-docs").createSignedUrls(docs.map((d) => d.path), 60 * 60)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl ?? undefined]));
  const have = new Set(docs.map((d) => d.kind));

  return (
    <section className="card">
      <h2 className="card-title"><Paperclip size={18} className="text-zinc-500" /> {t("الأوراق")} <span className="num text-sm font-normal text-zinc-400">({docs.length})</span></h2>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["id_front", "id_back", "license", "vehicle_license", "photo"] as const).map((k) => (
          <span key={k} className={`badge ${have.has(k) ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-500"}`}>
            {have.has(k) ? "✓" : "○"} {t(DOC_KINDS[k])}
          </span>
        ))}
      </div>
      <DocUploader leadId={leadId} />
      {docs.length === 0 ? (
        <div className="mt-4"><Empty icon={FileText}>{t("لسه مفيش أوراق")}</Empty></div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {docs.map((d) => {
            const url = urlOf.get(d.path);
            const image = d.mime?.startsWith("image/") && d.mime !== "image/heic";
            return (
              <li key={d.id} className="group overflow-hidden rounded-xl border border-zinc-200">
                <a href={url} target="_blank" rel="noreferrer" className="block bg-zinc-50">
                  {image && url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={url} alt={t(DOC_KINDS[d.kind as keyof typeof DOC_KINDS] ?? "أخرى")} className="h-36 w-full object-cover transition group-hover:scale-[1.02]" />
                  ) : (
                    <span className="grid h-36 place-items-center text-zinc-400"><FileText size={36} /></span>
                  )}
                </a>
                <div className="flex items-center gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{t(DOC_KINDS[d.kind as keyof typeof DOC_KINDS] ?? "أخرى")}</p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {(d.uploader as unknown as { full_name: string } | null)?.full_name ?? "—"} · {formatDate(d.created_at)}
                    </p>
                  </div>
                  {(staff || d.uploaded_by === userId) && (
                    <form action={deleteDocument}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t("حذف")} title={t("حذف")}>
                        <Trash2 size={15} />
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
