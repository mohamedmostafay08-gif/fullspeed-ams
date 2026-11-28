import { CloudUpload, DatabaseBackup, Download, Gauge, Megaphone, MessageCircle, PlugZap, Trash2 } from "lucide-react";
import { addLeadForm, backupNow, deleteLeadForm, saveDriveUrl, saveLineCrm, saveLineCrmChat, saveLineCrmKey, saveMeta, saveWhatsApp, testWhatsApp } from "@/app/actions/integrations";
import { headers } from "next/headers";
import { PageHeader } from "@/components/app-shell";
import { CONNECT_TABS, SubTabs } from "@/components/sub-tabs";
import { StateForm } from "@/components/state-form";
import { Empty, formatDate } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ensureSecret, getConfig } from "@/lib/app-config";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createAdminClient, hasServiceKey, MISSING_SERVICE_KEY } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";

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
  const [cfg, driveSecret, verifyToken, { data: files }] = await Promise.all([
    getConfig(),
    ensureSecret("drive_secret"),
    ensureSecret("meta_verify_token"),
    db.storage.from("backups").list("", { limit: 60, sortBy: { column: "name", order: "desc" } }),
  ]);
  const backups = (files ?? []).filter((f) => f.name.endsWith(".json.gz"));
  const { data: signed } = backups.length ? await db.storage.from("backups").createSignedUrls(backups.map((f) => f.name), 600) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  // Usage is read as the signed-in admin (the function checks the caller).
  const { data: usageData } = await (await createClient()).rpc("admin_usage");
  const usage = usageData as {
    db_bytes: number; leads: number; people: number; files: Record<string, { bytes: number; count: number }>;
    last_backup_at: string | null; drive_backup_at: string | null; drive_status: number | null;
    drive_error?: string | null;
  } | null;
  const userDb = await createClient();
  const [formsRes, eventsRes, companiesRes] = await Promise.all([
    userDb.from("meta_lead_forms").select("form_id, name, companies(name)").order("created_at"),
    userDb.from("meta_lead_events").select("leadgen_id, form_id, status, created_at").order("created_at", { ascending: false }).limit(10),
    userDb.from("companies").select("id, name").eq("is_active", true).order("name"),
  ]);
  const { data: lineEvents } = await userDb.from("linecrm_events").select("id, type, payload, raw, signature, verified, scheme, status, details, detail_error, created_at").order("created_at", { ascending: false }).limit(10);
  const host = (await headers()).get("host") ?? "ams.fullspeedlogistics.com";
  const webhookUrl = `https://${host}/api/meta/webhook`;
  const lineUrl = `https://${host}/api/linecrm/webhook`;
  const LINE: Record<string, string> = { received: "✅ متوقّع ومتحفظ", unverified: "⏳ اتحفظ من غير تحقق (لسه مفيش secret)", bad_signature: "🔒 التوقيع مش مطابق", chat: "💬 رسالة واتساب اتحفظت", chat_error: "⚠️ رسالة واتساب ماتحفظتش" };
  const EVENT: Record<string, string> = { created: "✅ اتعمل ليد", duplicate: "♻️ مكرر", invalid: "❌ بيانات ناقصة", unmapped: "⏳ مستني توزيع", dismissed: "🚫 اتجاهل", no_access: "🔒 مقدرناش نقرا البيانات", blacklisted: "⛔ بلاك ليست", error: "⚠️ مشكلة", pending: "…" };
  const fileBytes = Object.values(usage?.files ?? {}).reduce((s, f) => s + Number(f.bytes), 0);
  const MB = 1024 * 1024;

  return (
    <>
      <PageHeader title={t("النسخ والتكاملات")} subtitle={t("نسخة احتياطية كل يوم الساعة 3 الفجر، وربط Google Drive وواتساب")} />
      <SubTabs tabs={CONNECT_TABS} current="/admin/integrations" />
      {usage && (
        <section className="card mb-6">
          <h2 className="card-title"><Gauge size={18} className="text-teal-600" /> {t("الاستهلاك من الباقة المجانية")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { label: t("الداتابيز"), used: usage.db_bytes, limit: 500 * MB },
              { label: t("الملفات (أوراق الكباتن والنسخ)"), used: fileBytes, limit: 1024 * MB },
            ].map((m) => {
              const pct = Math.min(100, Math.round((100 * m.used) / m.limit));
              return (
                <div key={m.label}>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{m.label}</span><span className="num text-zinc-500">{Math.round(m.used / MB)} / {Math.round(m.limit / MB)} MB</span></div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className={`h-full rounded-full ${pct >= 70 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(pct, 1)}%` }} /></div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            {t("{0} ليد · {1} موظف نشط", usage.leads, usage.people)} · {t("آخر نسخة في السيستم:")} {formatDate(usage.last_backup_at)} · {t("آخر نسخة على Google Drive:")} {formatDate(usage.drive_backup_at)}
            {usage.drive_status != null && (usage.drive_status === 200 || usage.drive_status === 302 ? " ✓" : ` ✗ (${usage.drive_status})`)}
          </p>
          {usage.drive_error && (
            <p className="mt-1 text-xs text-red-600" dir="ltr">{t("رد جوجل درايف:")} {usage.drive_error}</p>
          )}
          <p className="mt-1 text-xs text-zinc-500">{t("لما أي واحد يعدّي 70% (اللون الأحمر)، وقتها نطلع لباقة Supabase Pro.")}</p>
        </section>
      )}
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
              <label className="block">
                <span className="label">{t("قالب تذكير المقابلة (اختياري)")}</span>
                <input name="reminder_template" dir="ltr" defaultValue={cfg.wa_reminder_template ?? ""} placeholder="interview_reminder" className="input text-left" />
                <span className="mt-1 block text-xs text-zinc-500">{t("بيتبعت للكابتن قبل المقابلة بيوم وقبلها بساعة. متغيراته: {{1}} الاسم، {{2}} الشركة، {{3}} المعاد، {{4}} المكان.")}</span>
              </label>
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
        <section className="card lg:col-span-2">
          <h2 className="card-title"><Megaphone size={18} className="text-sky-600" /> {t("ربط Meta: رسايل الواتساب الجاية + فورم إعلانات فيسبوك")}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 text-sm leading-7">
              <p className="font-semibold">{t("1) في Meta for Developers ← تطبيقك ← Webhooks، حط القيم دي:")}</p>
              <label className="block"><span className="label">Callback URL</span><input readOnly value={webhookUrl} dir="ltr" className="input text-left font-mono text-xs" /></label>
              <label className="block"><span className="label">Verify token</span><input readOnly value={verifyToken} dir="ltr" className="input text-left font-mono text-xs" /></label>
              <p className="text-zinc-500">{t("2) اشترك في: WhatsApp Business Account ← messages، و Page ← leadgen.")}</p>
              <StateForm action={saveMeta} className="space-y-3">
                <label className="block">
                  <span className="label">App secret</span>
                  <input name="app_secret" type="password" dir="ltr" autoComplete="off" placeholder={cfg.meta_app_secret ? "•••••••• (" + t("محفوظ") + ")" : t("من App settings ← Basic")} className="input text-left" />
                </label>
                <label className="block">
                  <span className="label">{t("توكن الصفحة (لفورم الإعلانات)")}</span>
                  <input name="page_token" type="password" dir="ltr" autoComplete="off" placeholder={cfg.meta_page_token ? "•••••••• (" + t("محفوظ") + ")" : t("لو فاضي هيستخدم توكن الواتساب")} className="input text-left" />
                </label>
                <label className="block">
                  <span className="label">{t("الشركة اللي ليدز الواتساب الجديدة بتدخل عليها")}</span>
                  <select name="inbox_company" defaultValue={cfg.wa_inbox_company ?? ""} className="input">
                    <option value="">{t("— ولا شركة (الأدمن يختار من صندوق الواتساب) —")}</option>
                    {(companiesRes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="auto_lead" defaultChecked={cfg.wa_auto_lead === "1"} className="size-4 accent-brand-600" /> {t("أي رقم جديد يبعت واتساب يبقى ليد أوتوماتيك ويتوزع")}
                </label>
              </StateForm>
              <p className={`badge ${cfg.meta_app_secret ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {cfg.meta_app_secret ? t("✅ الـ App secret متحفظ — الويب هوك جاهز") : t("⏳ لسه محتاج App secret")}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-semibold">{t("فورمز الإعلانات وكل فورم بيدخل على أنهي شركة")}</p>
                {(formsRes.data ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-500">{t("مفيش فورمز مربوطة لسه")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {(formsRes.data ?? []).map((f) => (
                      <li key={f.form_id} className="flex items-center gap-2 rounded-xl border border-(--glass-line) px-3 py-2 text-sm">
                        <span className="num text-xs text-zinc-500" dir="ltr">{f.form_id}</span>
                        <span className="flex-1 truncate">{f.name ?? ""} ← <b>{(f.companies as unknown as { name: string } | null)?.name}</b></span>
                        <ActionForm action={deleteLeadForm}><input type="hidden" name="form_id" value={f.form_id} /><button className="btn-ghost px-2 text-rose-600" aria-label={t("امسح")}><Trash2 size={15} /></button></ActionForm>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <StateForm action={addLeadForm} className="grid gap-2 sm:grid-cols-2" submitLabel={t("اربط الفورم")}>
                <input name="form_id" inputMode="numeric" dir="ltr" placeholder={t("رقم الفورم (Form ID)")} required className="input text-left" />
                <input name="name" placeholder={t("اسم للفورم (اختياري)")} className="input" />
                <select name="company_id" required defaultValue="" className="input sm:col-span-2">
                  <option value="" disabled>{t("الشركة")}</option>
                  {(companiesRes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </StateForm>
              <div>
                <p className="mb-2 text-sm font-semibold">{t("آخر ليدز جت من فيسبوك")}</p>
                <p className="mb-2 text-xs text-zinc-500">
                  {t("ليدز الفورمز اللي مش مربوطة بشركة بتستنى في")} <a href="/admin/facebook-leads" className="font-semibold text-brand-700 underline">{t("ليدز للتوزيع")}</a>
                </p>
                {(eventsRes.data ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-500">{t("لسه مفيش")}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {(eventsRes.data ?? []).map((e) => (
                      <li key={e.leadgen_id} className="flex items-center gap-2">
                        <span className="num text-xs text-zinc-400">{formatDate(e.created_at)}</span>
                        <span className="num text-xs text-zinc-500" dir="ltr">{e.form_id}</span>
                        <span className="ms-auto">{t(EVENT[e.status] ?? e.status)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="card lg:col-span-2">
          <h2 className="card-title"><PlugZap size={18} className="text-violet-600" /> {t("ربط LineCRM: إشعارات الأحداث")}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 text-sm leading-7">
              <p className="font-semibold">{t("1) في LineCRM ← الإعدادات ← المطورون والواجهة البرمجية ← إشعارات الأحداث ← عنوان جديد، حط العنوان ده:")}</p>
              <label className="block"><span className="label">{t("عنوان الاستقبال")}</span><input readOnly value={lineUrl} dir="ltr" className="input text-left font-mono text-xs" /></label>
              <p className="text-zinc-500">{t("2) اختار: إنشاء عميل محتمل (lead.created). 3) LineCRM هيوريك الـ secret مرة واحدة — انسخه وحطه هنا.")}</p>
              <StateForm action={saveLineCrm} className="space-y-3">
                <label className="block">
                  <span className="label">{t("الـ secret بتاع LineCRM")}</span>
                  <input name="secret" type="password" dir="ltr" autoComplete="off" placeholder={cfg.linecrm_webhook_secret ? "•••••••• (" + t("محفوظ") + ")" : ""} className="input text-left" required />
                </label>
              </StateForm>
              <p className={`badge ${cfg.linecrm_webhook_secret ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {cfg.linecrm_webhook_secret ? t("✅ الـ secret متحفظ") : t("⏳ لسه محتاج الـ secret")}
              </p>
              <p className="pt-2 text-zinc-500">{t("4) إشعار الليد الجديد مفيهوش رقم التليفون: اعمل في LineCRM مفتاح API «قراية بس» للعملاء المحتملين وجهات الاتصال، وحطه هنا، والسيستم هيجيب باقي بيانات كل ليد.")}</p>
              <StateForm action={saveLineCrmKey} className="space-y-3">
                <label className="block">
                  <span className="label">{t("مفتاح LineCRM API (قراية بس)")}</span>
                  <input name="api_key" type="password" dir="ltr" autoComplete="off" placeholder={cfg.linecrm_api_key ? "•••••••• (" + t("محفوظ") + ")" : ""} className="input text-left" required />
                </label>
              </StateForm>
              <p className={`badge ${cfg.linecrm_api_key ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {cfg.linecrm_api_key ? t("✅ مفتاح الـ API متحفظ") : t("⏳ لسه محتاج مفتاح الـ API")}
              </p>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">{t("آخر إشعارات جت من LineCRM")}</p>
              {(lineEvents ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">{t("لسه مفيش")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(lineEvents ?? []).map((e) => (
                    <li key={e.id}>
                      <details>
                        <summary className="flex cursor-pointer items-center gap-2">
                          <span className="num text-xs text-zinc-400">{formatDate(e.created_at)}</span>
                          <span className="num text-xs text-zinc-500" dir="ltr">{e.type ?? "—"}</span>
                          <span className="ms-auto">{t(LINE[e.status] ?? e.status)}</span>
                        </summary>
                        <p className="mt-1 text-xs text-zinc-500" dir="ltr">scheme: {e.scheme ?? "—"} · signature: {e.signature ? `${String(e.signature).slice(0, 12)}… (${String(e.signature).length})` : "—"}</p>
                        <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-zinc-50 p-2 text-left text-xs" dir="ltr">{e.payload ? JSON.stringify(e.payload, null, 2) : e.raw}</pre>
                        {(e.details != null || e.detail_error) && (
                          <>
                            <p className="mt-2 text-xs font-semibold">{t("بيانات الليد من LineCRM")} {e.detail_error ? `(${e.detail_error})` : ""}</p>
                            <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-zinc-50 p-2 text-left text-xs" dir="ltr">{JSON.stringify(e.details, null, 2)}</pre>
                          </>
                        )}
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
        <section className="card lg:col-span-2">
          <h2 className="card-title"><MessageCircle size={18} className="text-emerald-600" /> {t("شات الواتساب من جوه السيستم (رقم LineCRM)")}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2 text-sm leading-7">
              <p>{t("الإيجنت يكلّم الليد من صفحة الليد، من نفس الرقم اللي الليد كلّمه في الإعلان، والمحادثة كلها بتتحفظ على الليد والمدير يشوفها. زرار الواتساب مش هيفتح واتساب الموبايل الشخصي.")}</p>
              <p className="font-semibold">{t("1) في LineCRM ← إشعارات الأحداث ← العنوان بتاع Full Speed AMS: علّم كمان «وصول رسالة» (message.received) و«إرسال رسالة» (message.sent).")}</p>
              <p className="font-semibold">{t("2) اعمل مفتاح API جديد بصلاحيات: messages:write و messages:read و channels:read، وحطه هنا.")}</p>
              <p className="text-zinc-500">{t("كل رسالة يبعتها الإيجنت بتاكل طلب واحد من رصيد LineCRM الشهري. الرسايل اللي بتيجي مجانية.")}</p>
            </div>
            <StateForm action={saveLineCrmChat} className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="enabled" defaultChecked={cfg.wa_provider === "linecrm"} className="size-4 accent-brand-600" /> {t("شغّل الشات من رقم LineCRM")}
              </label>
              <label className="block">
                <span className="label">{t("الـ secret بتاع عنوان الرسايل (لو الرسايل متسجلة على عنوان لوحدها في LineCRM)")}</span>
                <input name="chat_secret" type="password" dir="ltr" autoComplete="off" placeholder={cfg.linecrm_chat_secret ? "•••••••• (" + t("محفوظ") + ")" : ""} className="input text-left" />
              </label>
              <label className="block">
                <span className="label">{t("مفتاح الإرسال (messages:write)")}</span>
                <input name="send_key" type="password" dir="ltr" autoComplete="off" placeholder={cfg.linecrm_send_key ? "•••••••• (" + t("محفوظ") + ")" : ""} className="input text-left" />
              </label>
              <label className="block">
                <span className="label">{t("رقم الحساب المربوط (اختياري، لو عندكم أكتر من رقم واتساب)")}</span>
                <input name="account" dir="ltr" defaultValue={cfg.linecrm_wa_account ?? ""} className="input text-left" />
              </label>
              <label className="block">
                <span className="label">{t("الغرض (purpose) لقالب فتح المحادثة بعد 24 ساعة (اختياري)")}</span>
                <input name="purpose" dir="ltr" defaultValue={cfg.linecrm_wa_purpose ?? ""} placeholder="welcome" className="input text-left" />
              </label>
            </StateForm>
          </div>
        </section>
      </div>
    </>
  );
}
