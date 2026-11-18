# Full Speed — Acquisition Management System

نظام إدارة فريق الأكوزيشن (تعيين المناديب) لشركة Full Speed: الأدمن والتيم ليدرز بيوزعوا الشركات والتاسكات ويتابعوا الأداء،
والأجنتس بيسجلوا المتقدمين من الإعلانات على فورم خاص بكل شركة.

## المميزات

| | |
|---|---|
| **صلاحيات** | أدمن (كل حاجة) · تيم ليدر (فريقه بس) · أجنت (الليدز والتاسكات بتاعته بس) — متطبقة على مستوى الداتابيز (RLS) |
| **الشركات** | 27 شركة باللوجو · فورم مخصص لكل شركة (Form Builder) · المحافظات اللي بتعيّن فيها |
| **الليدز** | تسجيل يدوي · استيراد CSV مع توزيع تلقائي · ربط CRM (API) · منع التكرار · سجل حركة لكل ليد · تصدير Excel |
| **الأداء** | تارجت يومي لكل أجنت × شركة · لوحة تحكم بالفترة · أداء كل أجنت وكل شركة · نسبة التحويل |
| **التاسكات** | تاسك لأجنت أو أكتر بأولوية وميعاد · الأجنت يحدّث الحالة |
| **الإشعارات** | لحظية (Realtime): بونص / تعريفة لشركة بتوصل لكل الأجنتس المتعينين عليها · تاسك جديد · ليد جديد · رسائل مباشرة |
| **الجغرافيا** | 27 محافظة + 312 منطقة |

## التقنيات

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Auth + Realtime + Storage)

## التشغيل

### 1) Supabase
1. اعمل project جديد على [supabase.com](https://supabase.com) (أقرب Region: Frankfurt `eu-central-1`).
2. طبّق الـ migrations:
   ```bash
   npx supabase link --project-ref <PROJECT_REF>
   npx supabase db push
   ```
   (أو انسخ ملفات `supabase/migrations/*.sql` بالترتيب في SQL Editor.)
3. من **Project Settings → API** خد الـ URL والـ publishable key والـ service role key.

### 2) المتغيرات
```bash
cp .env.example .env.local   # واملأ القيم
```

### 3) أول أدمن
```bash
npm install
node --env-file=.env.local scripts/create-admin.mjs admin@fullspeed.com "StrongPass123" "اسمك"
```

### 4) التشغيل
```bash
npm run dev        # http://localhost:3000
```

### النشر على Vercel
اربط الـ repo بـ Vercel وحط نفس المتغيرات الأربعة في **Environment Variables**.

## ربط الـ CRM

- **استقبال ليدز:** `POST /api/crm/leads` بهيدر `x-api-key: CRM_WEBHOOK_SECRET` — ليد واحد أو Array لحد 500.
  السيستم بيمنع التكرار ويوزّع على الأجنت المتعين على الشركة اللي عنده أقل ليدز النهارده.
- **رجوع الحالات:** `GET /api/crm/leads?since=<ISO timestamp>` بيرجّع كل الليدز اللي اتغيرت.
- التفاصيل وأكواد الشركات في صفحة **ربط الـ CRM** جوه السيستم.

## التطوير المحلي (اختياري)
```bash
npx supabase start   # محتاج Docker — بيطبق الـ migrations تلقائياً
```
تعديل المحافظات أو الشركات المبدئية: `supabase/seed/build_seed.py` ثم `python3 supabase/seed/build_seed.py`.
