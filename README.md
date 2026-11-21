# Full Speed — Acquisition Management System · v1.0

نظام إدارة فريق الأكوزيشن (تعيين الكباتن) لشركة Full Speed Logistics.
الأدمن والمديرين والتيم ليدرز بيوزعوا الشركات والتاسكات ويتابعوا الأداء لايف، والأجنتس بيسجلوا ويكلموا المتقدمين
لحد ما يتعينوا — من الموبايل أو الكمبيوتر، بالعربي أو الإنجليزي.

**الموقع:** https://ams.fullspeedlogistics.com

## المميزات

| | |
|---|---|
| **الصلاحيات** | أدمن · مدير أكوزيشن (يضيف تيم ليدر وأجنت بس) · تيم ليدر (فريقه بس) · أجنت (حاجته بس) — متطبقة على مستوى الداتابيز (RLS) |
| **الدخول** | إيميل وكلمة سر · بصمة / Face ID (Passkeys) · مكان شغل لكل أجنت (يتأكد كل 4 ساعات) |
| **الشركات** | 27 شركة باللوجو · فورم مخصص لكل شركة (يدوي أو من Google Form) · سكربت مكالمة · المحافظات |
| **الليدز** | تسجيل يدوي · استيراد CSV مع توزيع تلقائي · ربط CRM · منع التكرار · بلاك ليست · جدول أو لوحة Kanban · تصدير Excel |
| **المكالمات** | وضع «ابدأ المكالمات» (ليد ورا التاني بالأولوية) · مدة المكالمة · نتيجة بضغطة · مواعيد إعادة الاتصال والمقابلات مع تذكير · قوالب واتساب |
| **الأوراق** | رفع/تصوير البطاقة والرخص والصور في مساحة خاصة |
| **المنافسة** | ترتيب النهارده بالنقط · Streak · 9 شارات · احتفال عند التعيين وتحقيق التارجت |
| **الإدارة** | متابعة لايف (مين شغال / بريك / واقف) · شاشة المكتب (TV) · تنبيهات التأخير · بريكات بموافقة · سجل كل التعديلات |
| **التقارير** | تحليلات بالفترة · تقرير يومي / أسبوعي / شهري بمقارنة · توقع آخر الشهر مع تنبيه لو التارجت في خطر |
| **الإشعارات** | لحظية داخل السيستم + Push على الموبايل حتى لو مقفول (بونص، ليد جديد، تذكيرات، تقارير) |
| **التطبيق** | PWA يتثبت على الموبايل والكمبيوتر · شاشة لما النت يقطع · وضع فاتح/غامق · عربي/إنجليزي |
| **الأمان والبيانات** | نسخة احتياطية يومية (آخر 30 يوم) + Google Drive اختياري · رسالة ترحيب واتساب أوتوماتيك (WhatsApp Cloud API، اختياري) |

## التقنيات

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + RLS + Auth + Realtime + Storage + pg_cron + pg_net)
· Web Push (VAPID) · WebAuthn (SimpleWebAuthn) · الاستضافة على Cloudflare Workers عن طريق [OpenNext](https://opennext.js.org/cloudflare) (نشر تلقائي من فرع `main`).

## التشغيل

### 1) Supabase
1. Project على [supabase.com](https://supabase.com) (الحالي: `eu-west-1`).
2. طبّق الـ migrations بالترتيب (`supabase/migrations/0001` → آخر ملف):
   ```bash
   npx supabase link --project-ref <PROJECT_REF>
   npx supabase db push
   ```
3. بعد أول نشر عرّف عنوان الموقع للداتابيز (عشان الإشعارات والنسخ والواتساب):
   ```sql
   select public.set_push_config('app_url', 'https://ams.fullspeedlogistics.com');
   ```

### 2) النشر على Cloudflare Workers
من Cloudflare: **Workers & Pages ← Create ← Import a repository** واختار الريبو، بالإعدادات دي:

| | |
|---|---|
| Build command | `npm run cf:build` |
| Deploy command | `npx wrangler deploy` |
| Variables and Secrets (الـ Worker) | `SUPABASE_SERVICE_ROLE_KEY` · `CRM_WEBHOOK_SECRET` (Secret) |

القيم العامة (`NEXT_PUBLIC_*`) موجودة في `.env.production` جوه الريبو. الإعدادات في `wrangler.jsonc` و`open-next.config.ts`. للتجربة المحلية بنفس بيئة Cloudflare: حط الأسرار في `.dev.vars` وشغّل `npm run cf:preview`.
الـ `overrides` في `package.json` بتثبّت `cookie@0.7.2` لـ OpenNext، لأن `cookie@1` بيكسر قراءة الكوكيز في الـ proxy على Cloudflare.
مفاتيح الإشعارات (VAPID) وأسرار الجدولة بتتعمل تلقائياً جوه الداتابيز (`private.app_config`) — مش محتاجة إعداد.

### 3) أول أدمن
```bash
npm install
node --env-file=.env.local scripts/create-admin.mjs admin@fullspeed.com "StrongPass123" "اسمك"
```

### 4) التشغيل المحلي
```bash
npx supabase start   # محتاج Docker — بيطبق الـ migrations
npm run dev          # http://localhost:3000
```

## المهام المجدولة (pg_cron)

| المهمة | الموعد | الوظيفة |
|---|---|---|
| `fire-due-reminders` | كل دقيقة | تذكير مواعيد المكالمات والمقابلات |
| `fire-delay-alerts` | كل 5 دقايق (9 ص–10 م) | ليدز متأخرة، أجنت واقف، رجوع من البريك |
| `send-daily-report` | 9 م | إشعار التقرير اليومي |
| `send-period-reports` | كل ساعة (بيبعت السبت وأول الشهر) | التقرير الأسبوعي والشهري وتنبيه التارجت |
| `daily-backup` | 3 الفجر (القاهرة) | نسخة احتياطية + Google Drive لو متربط |

## ربط الـ CRM

- **استقبال ليدز:** `POST /api/crm/leads` بهيدر `x-api-key: CRM_WEBHOOK_SECRET` — ليد واحد أو Array لحد 500.
  السيستم بيمنع التكرار والأرقام المحظورة، ويوزّع على الأجنت المتعين على الشركة اللي عنده أقل ليدز النهارده.
- **رجوع الحالات:** `GET /api/crm/leads?since=<ISO timestamp>` بيرجّع كل الليدز اللي اتغيرت.
- التفاصيل وأكواد الشركات في صفحة **ربط الـ CRM** جوه السيستم.

## التكاملات الاختيارية

من **النسخ والتكاملات** (للأدمن):
- **Google Drive:** كود Apps Script جاهز في الصفحة — Deploy كـ Web app وحط الرابط.
- **واتساب أوتوماتيك:** Phone number ID + Access token + اسم قالب متوافق عليه من Meta فيه `{{1}}` الاسم و `{{2}}` الشركة.

تعديل المحافظات أو الشركات المبدئية: `supabase/seed/build_seed.py` ثم `python3 supabase/seed/build_seed.py`.
