"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playSound } from "@/lib/fx";
import { useT } from "@/lib/i18n/client";
import { DOC_KINDS } from "@/lib/types";

const MAX = 10 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

/** Shrinks a phone photo (often 3–5 MB) to ≤1600 px JPEG before upload; other files pass through. */
async function compress(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 400 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.8));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Uploads straight from the browser to the private bucket (RLS checks the lead), then records the file. */
export function DocUploader({ leadId }: { leadId: string }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("id_front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    const supabase = createClient();
    try {
      for (const original of Array.from(files)) {
        if (!OK_TYPES.includes(original.type)) throw new Error(t("نوع الملف لازم يكون صورة أو PDF"));
        if (original.size > MAX) throw new Error(t("الملف أكبر من 10 ميجا"));
        const file = await compress(original);
        const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
        const path = `${leadId}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("lead-docs").upload(path, file, { contentType: file.type });
        if (up.error) throw new Error(t("مقدرتش أرفع الملف"));
        const { data: auth } = await supabase.auth.getUser();
        const row = await supabase
          .from("lead_documents")
          .insert({ lead_id: leadId, kind, path, file_name: file.name.slice(0, 150), mime: file.type, size: file.size, uploaded_by: auth.user?.id });
        if (row.error) {
          await supabase.storage.from("lead-docs").remove([path]);
          throw new Error(t("مقدرتش أرفع الملف"));
        }
        await supabase.rpc("log_lead_note", { p_lead: leadId, p_note: "📎 اترفع مستند" });
      }
      playSound("notify");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("مقدرتش أرفع الملف"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input w-auto flex-1" aria-label={t("نوع المستند")}>
          {Object.entries(DOC_KINDS).map(([k, l]) => (
            <option key={k} value={k}>{t(l)}</option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-dark">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {t("ارفع")}
        </button>
        <label className="btn-ghost cursor-pointer md:hidden">
          <Camera size={16} /> {t("صوّر")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => upload(e.target.files)} disabled={busy} />
        </label>
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
      <p className="text-[11px] text-zinc-400">{t("صور أو PDF — لحد 10 ميجا للملف")}</p>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
