"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importLeadRows } from "@/app/admin/actions";
import { parseCsv } from "@/lib/csv";
import { useT } from "@/lib/i18n/client";

const NAME_HEADERS = ["name", "full_name", "full name", "الاسم", "اسم", "الاسم بالكامل"];
const PHONE_HEADERS = ["phone", "mobile", "phone_number", "الموبايل", "رقم الموبايل", "التليفون", "الرقم", "رقم"];
const GOV_HEADERS = ["governorate", "city", "المحافظة", "محافظة"];
const REGION_HEADERS = ["region", "area", "المنطقة", "منطقة"];
const CHUNK = 1000;

type Totals = { inserted: number; dupes: number; skipped: number; blocked: number };

/** Reads the CSV in the browser and sends it in batches; the database checks duplicates,
 * the blacklist and spreads the leads — so a big file never strains the server. */
export function LeadImport({ companies, agents }: { companies: { id: string; name: string }[]; agents: { id: string; full_name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    const companyId = String(form.get("company_id") ?? "");
    const distribute = String(form.get("distribute") ?? "auto");
    setResult(null);
    if (!file || file.size === 0 || !companyId) return setResult({ error: t("اختار الشركة والملف") });
    if (file.size > 10 * 1024 * 1024) return setResult({ error: t("الملف أكبر من 10 ميجا") });

    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setResult({ error: t("الملف فاضي — لازم أول سطر يكون أسماء الأعمدة") });
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const find = (opts: string[]) => headers.findIndex((h) => opts.includes(h));
    const [iName, iPhone, iGov, iRegion] = [find(NAME_HEADERS), find(PHONE_HEADERS), find(GOV_HEADERS), find(REGION_HEADERS)];
    if (iName < 0 || iPhone < 0) return setResult({ error: t("لازم يكون فيه عمود للاسم (name / الاسم) وعمود للموبايل (phone / الموبايل)") });

    const items = rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
      const x: Record<string, string> = {};
      headers.forEach((_, i) => {
        if (![iName, iPhone, iGov, iRegion].includes(i) && r[i]?.trim()) x[rows[0][i].trim()] = r[i].trim().slice(0, 500);
      });
      return { n: r[iName] ?? "", p: r[iPhone] ?? "", g: iGov >= 0 ? r[iGov] ?? "" : "", r: iRegion >= 0 ? r[iRegion] ?? "" : "", x };
    });

    setBusy(true);
    const total: Totals = { inserted: 0, dupes: 0, skipped: 0, blocked: 0 };
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        setProgress(t("جاري الاستيراد… {0} من {1}", Math.min(i + CHUNK, items.length), items.length));
        const res = await importLeadRows(companyId, distribute, items.slice(i, i + CHUNK));
        if ("error" in res) {
          setResult({ error: i ? t("اتسجل {0} بس — حصل خطأ: {1}", total.inserted, res.error) : res.error });
          return;
        }
        for (const k of Object.keys(total) as (keyof Totals)[]) total[k] += res[k];
      }
      const summary = t("اتسجل {0} ليد · {1} مكرر · {2} بيانات ناقصة", total.inserted, total.dupes, total.skipped);
      setResult({ ok: total.blocked ? `${summary} · ${t("{0} في البلاك ليست", total.blocked)}` : summary });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
      <select name="company_id" required className="input">
        <option value="">{t("الشركة")}</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select name="distribute" defaultValue="auto" className="input">
        <option value="auto">{t("وزّع بالتساوي على أجنتس الشركة")}</option>
        <option value="none">{t("من غير تعيين")}</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{t("كلهم لـ")} {a.full_name}</option>)}
      </select>
      <input name="file" type="file" accept=".csv,text/csv" required className="input" />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-full">
        <button className="btn-primary" disabled={busy}>{busy ? t("جاري...") : t("استيراد")}</button>
        {progress && <p className="text-sm text-zinc-500">{progress}</p>}
        {result?.error && <p className="text-sm text-rose-600">{result.error}</p>}
        {result?.ok && <p className="text-sm text-emerald-600">{result.ok}</p>}
      </div>
    </form>
  );
}
