import { CloudUpload, DatabaseBackup, Download, MessageCircle } from "lucide-react";
import { backupNow, saveDriveUrl, saveWhatsApp, testWhatsApp } from "@/app/actions/integrations";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { ensureSecret, getConfig } from "@/lib/app-config";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createAdminClient, hasServiceKey, MISSING_SERVICE_KEY } from "@/lib/supabase/admin";

const kb = (n?: number) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : "—");

function appsScript(secret: string) {
  return `// Full Speed — daily backup to Google Drive
const SECRET = "${secret}";
const FOLDER = "Full Speed Backups";

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return out({ ok: false, error: "forbidden" });
  const it = DriveApp.getFoldersByName(FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
  const same = folder.getFilesByName(body.name);
  while (same.hasNext()) same.next().setTrashed(true);
  folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.data), "application/gzip", body.name));
  const files = [];
  const all = folder.getFiles();
  while (all.hasNext()) files.push(all.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(30).forEach((f) => f.setTrashed(true));
  return out({ ok: true });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}`;
}

export default async function IntegrationsPage() {
  const t = await getT();
  await requireRole("admin");
  if (!hasServiceKey()) return <Empty>{MISSING_SERVICE_KEY}</Empty>;
  const db = createAdminClient();
  const [cfg, driveSecret, { data: files }] = await Promise.all([
    getConfig(),
    ensureSecret("drive_secret"),
    db.storage.from("backups").list("", { limit: 60, sortBy: { column: "name", order: "desc" } }),
  ]);
  const backups = (files ?? []).filter((f) => f.name.endsWith(".json.gz"));
  const { data: signed } = backups.length ? await db.storage.from("backups").createSignedUrls(backups.map((f) => f.name), 600) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <>
      <PageHeader title={t("النسخ والتكاملات")} subtitle={t("نسخة احتياطية كل يوم الساعة 3 الفجر، وربط Google Drive وواتساب")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="card-title"><DatabaseBackup size={18} className="text-brand-600" /> {t("النسخ الاحتياطية")}</h2>
          <p className="mb-3 text-sm text-zinc-500">{t("كل الليدز والفريق والشركات والسجلات في ملف واحد مضغوط. بنحتفظ بآخر 30 يوم.")}</p>
          <StateForm action={backupNow} submitLabel={t("اعمل نسخة دلوقتي")}>{null}</StateForm>
          <ul className="mt-4 divide-y divide-zinc-100">
            {backups.length === 0 && <li className="py-3 text-sm text-zinc-400">{t("لسه مفيش نسخ — أول نسخة هتتعمل الليلة")}</li>}
            {backups.map((f) => (
              <li key={f.name} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="num flex-1 font-semibold" dir="ltr">{f.name.replace("fullspeed-", "").replace(".json.gz", "")}</span>
                <span className="num text-xs text-zinc-500">{kb(f.metadata?.size as number | undefined)}</span>
                {url.get(f.name) && (
                  <a href={url.get(f.name)!} className="btn-ghost btn-sm"><Download size={14} /> {t("تحميل")}</a>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="card-title"><CloudUpload size={18} className="text-sky-600" /> {t("نسخة على Google Drive")}</h2>
          <p className="mb-2 text-sm">
            {cfg.drive_script_url ? <span className="badge bg-emerald-100 text-emerald-800">{t("متربط ✓")}</span> : <span className="badge bg-zinc-100 text-zinc-600">{t("مش متربط")}</span>}
          </p>
          <ol className="mb-3 list-decimal space-y-1 ps-5 text-sm text-zinc-600">
            <li>{t("افتح script.new وانت داخل بحساب جوجل اللي عايز النسخ تتحفظ فيه")}</li>
            <li>{t("امسح اللي موجود والصق الكود اللي تحت")}</li>
            <li>{t("Deploy ← New deployment ← Web app · Execute as: Me · Who has access: Anyone ← Deploy")}</li>
            <li>{t("وافق على الصلاحيات، وانسخ رابط الـ Web app والصقه هنا")}</li>
          </ol>
          <details className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{t("الكود")}</summary>
            <pre dir="ltr" className="max-h-64 overflow-auto px-3 pb-3 text-[11px] leading-5">{appsScript(driveSecret)}</pre>
          </details>
          <StateForm action={saveDriveUrl} className="space-y-2">
            <input name="url" dir="ltr" defaultValue={cfg.drive_script_url ?? ""} placeholder="https://script.google.com/macros/s/…/exec" className="input text-left" />
          </StateForm>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="card-title"><MessageCircle size={18} className="text-emerald-600" /> {t("رسالة ترحيب واتساب أوتوماتيك")}</h2>
          <p className="mb-3 text-sm text-zinc-500">
            {t("أول ما ليد يتسجل (من الفورم أو ملف أو الـ CRM) بتوصله رسالة واتساب من رقم الشركة. محتاجة WhatsApp Business Platform (Cloud API) من Meta وقالب رسالة متوافق عليه فيه متغيرين: {{1}} = الاسم، {{2}} = الشركة.")}
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <StateForm action={saveWhatsApp} className="space-y-3">
              <label className="block"><span className="label">Phone number ID</span><input name="phone_id" dir="ltr" defaultValue={cfg.wa_phone_id ?? ""} className="input text-left" required /></label>
              <label className="block">
                <span className="label">{t("Access token (مش بيظهر تاني بعد الحفظ)")}</span>
                <input name="token" type="password" dir="ltr" autoComplete="off" placeholder={cfg.wa_token ? "•••••••• (" + t("محفوظ") + ")" : ""} className="input text-left" />
              </label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="block"><span className="label">{t("اسم القالب")}</span><input name="template" dir="ltr" defaultValue={cfg.wa_template ?? ""} placeholder="lead_welcome" className="input text-left" required /></label>
                <label className="block"><span className="label">{t("اللغة")}</span><input name="lang" dir="ltr" defaultValue={cfg.wa_lang ?? "ar"} className="input w-20 text-left" /></label>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="enabled" defaultChecked={cfg.wa_enabled === "1"} className="size-4 accent-brand-600" /> {t("شغّل الرسالة الأوتوماتيك")}
              </label>
            </StateForm>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="mb-2 text-sm font-bold">{t("جرّب الإرسال")}</p>
              <StateForm action={testWhatsApp} className="space-y-2" submitLabel={t("ابعت رسالة تجربة")}>
                <input name="phone" inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" className="input text-left rtl:text-right" required />
              </StateForm>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
