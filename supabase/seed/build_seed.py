"""Generates supabase/migrations/0003_seed.sql (governorates, regions, companies)."""
from pathlib import Path

GOVERNORATES = [
    (1, "القاهرة", "Cairo", "مدينة نصر،مصر الجديدة،النزهة،التجمع الخامس،القاهرة الجديدة،الرحاب،مدينتي،الشروق،بدر،العاصمة الإدارية،المعادي،حلوان،المعصرة،15 مايو،التبين،المقطم،البساتين،دار السلام،مصر القديمة،المنيل،السيدة زينب،عابدين،وسط البلد،جاردن سيتي،الزمالك،بولاق،الأزبكية،الموسكي،باب الشعرية،الظاهر،الوايلي،شبرا،روض الفرج،الساحل،الشرابية،حدائق القبة،الزيتون،عين شمس،المطرية،المرج،السلام،الخليفة"),
    (2, "الجيزة", "Giza", "الدقي،المهندسين،العجوزة،إمبابة،الوراق،بولاق الدكرور،الجيزة،الهرم،فيصل،العمرانية،الطالبية،المنيب،6 أكتوبر،حدائق أكتوبر،الشيخ زايد،كرداسة،أوسيم،أبو النمرس،الحوامدية،البدرشين،العياط،الصف،أطفيح،منشأة القناطر،الواحات البحرية"),
    (3, "الإسكندرية", "Alexandria", "المنتزه،المندرة،العصافرة،سيدي بشر،ميامي،المعمورة،أبو قير،الرمل،سيدي جابر،سموحة،كليوباترا،محرم بك،العطارين،المنشية،الجمرك،كرموز،الدخيلة،العجمي،البيطاش،الهانوفيل،العامرية،برج العرب"),
    (4, "القليوبية", "Qalyubia", "بنها،شبرا الخيمة،قليوب،القناطر الخيرية،الخانكة،العبور،الخصوص،طوخ،كفر شكر،شبين القناطر،قها"),
    (5, "الشرقية", "Sharqia", "الزقازيق،العاشر من رمضان،بلبيس،منيا القمح،أبو حماد،أبو كبير،فاقوس،ههيا،ديرب نجم،كفر صقر،أولاد صقر،الحسينية،الإبراهيمية،مشتول السوق،القرين،الصالحية الجديدة،القنايات"),
    (6, "الدقهلية", "Dakahlia", "المنصورة،طلخا،ميت غمر،السنبلاوين،دكرنس،أجا،بلقاس،شربين،المنزلة،الجمالية،منية النصر،تمي الأمديد،بني عبيد،نبروه،المطرية،جمصة"),
    (7, "الغربية", "Gharbia", "طنطا،المحلة الكبرى،كفر الزيات،زفتى،السنطة،قطور،بسيون،سمنود"),
    (8, "المنوفية", "Monufia", "شبين الكوم،مدينة السادات،منوف،أشمون،الباجور،قويسنا،بركة السبع،تلا،الشهداء،سرس الليان"),
    (9, "البحيرة", "Beheira", "دمنهور،كفر الدوار،رشيد،إدكو،أبو المطامير،أبو حمص،الدلنجات،المحمودية،الرحمانية،إيتاي البارود،حوش عيسى،شبراخيت،كوم حمادة،بدر،وادي النطرون،النوبارية الجديدة"),
    (10, "كفر الشيخ", "Kafr El Sheikh", "كفر الشيخ،دسوق،فوه،مطوبس،بلطيم،البرلس،الحامول،بيلا،الرياض،سيدي سالم،قلين،سيدي غازي"),
    (11, "دمياط", "Damietta", "دمياط،دمياط الجديدة،رأس البر،فارسكور،الزرقا،كفر سعد،كفر البطيخ،عزبة البرج"),
    (12, "بورسعيد", "Port Said", "حي الشرق،حي العرب،حي المناخ،حي الضواحي،حي الزهور،حي الجنوب،بورفؤاد"),
    (13, "الإسماعيلية", "Ismailia", "الإسماعيلية،فايد،القنطرة شرق،القنطرة غرب،التل الكبير،أبو صوير،القصاصين"),
    (14, "السويس", "Suez", "حي السويس،حي الأربعين،حي عتاقة،حي الجناين،حي فيصل"),
    (15, "الفيوم", "Faiyum", "الفيوم،الفيوم الجديدة،سنورس،إطسا،طامية،يوسف الصديق،أبشواي"),
    (16, "بني سويف", "Beni Suef", "بني سويف،بني سويف الجديدة،الواسطى،ناصر،إهناسيا،ببا،الفشن،سمسطا"),
    (17, "المنيا", "Minya", "المنيا،المنيا الجديدة،ملوي،سمالوط،مطاي،بني مزار،مغاغة،العدوة،أبو قرقاص،دير مواس"),
    (18, "أسيوط", "Asyut", "أسيوط،أسيوط الجديدة،ديروط،القوصية،منفلوط،أبنوب،أبو تيج،الغنايم،ساحل سليم،البداري،صدفا،الفتح"),
    (19, "سوهاج", "Sohag", "سوهاج،سوهاج الجديدة،أخميم،البلينا،المراغة،المنشأة،دار السلام،جرجا،جهينة،ساقلتة،طما،طهطا"),
    (20, "قنا", "Qena", "قنا،نجع حمادي،دشنا،الوقف،قفط،قوص،نقادة،فرشوط،أبو تشت"),
    (21, "الأقصر", "Luxor", "الأقصر،إسنا،أرمنت،الطود،البياضية،القرنة،الزينية"),
    (22, "أسوان", "Aswan", "أسوان،كوم أمبو،إدفو،دراو،نصر النوبة،أبو سمبل"),
    (23, "البحر الأحمر", "Red Sea", "الغردقة،سفاجا،القصير،مرسى علم،رأس غارب،الشلاتين،حلايب"),
    (24, "الوادي الجديد", "New Valley", "الخارجة،الداخلة،الفرافرة،باريس،بلاط"),
    (25, "مطروح", "Matrouh", "مرسى مطروح،العلمين،الحمام،الضبعة،النجيلة،سيدي براني،السلوم،سيوة"),
    (26, "شمال سيناء", "North Sinai", "العريش،الشيخ زويد،رفح،بئر العبد،الحسنة،نخل"),
    (27, "جنوب سيناء", "South Sinai", "الطور،شرم الشيخ،دهب،نويبع،طابا،سانت كاترين،رأس سدر،أبو رديس،أبو زنيمة"),
]

# (name, slug, logo file in public/logos)
COMPANIES = [
    ("Amazon Now", "amazon-now", "amazon.jpg"),
    ("Bosta", "bosta", "bosta.png"),
    ("Breadfast", "breadfast", "breadfast.jpg"),
    ("Carrefour", "carrefour", "carrefour.jpg"),
    ("Flextock", "flextock", "flextock.jpg"),
    ("Halan", "halan", "halan.jpg"),
    ("Hassan Allam", "hassan-allam", "hassan-allam.jpg"),
    ("Instashop", "instashop", "instashop.png"),
    ("J&T", "jt", "jt.jpg"),
    ("JD Express", "jd-express", "jd-express.jpg"),
    ("Jumia", "jumia", "jumia.jpg"),
    ("Khazenly", "khazenly", "khazenly.jpg"),
    ("Lychee", "lychee", "lychee.jpg"),
    ("Maxab", "maxab", "maxab.jpg"),
    ("Mylerz", "mylerz", "mylerz.jpg"),
    ("Nacita Logistics", "nacita", "nacita.jpg"),
    ("NODUST", "nodust", "nodust.jpg"),
    ("Noon Core", "noon-core", "noon-core.jpg"),
    ("Noon Minutes", "noon-minutes", "noon-minutes.jpg"),
    ("PDC", "pdc", "pdc.jpg"),
    ("Rabbit", "rabbit", "rabbit.jpg"),
    ("Rumis", "rumis", "rumis.jpg"),
    ("TAGADDOD", "tagaddod", "tagaddod.jpg"),
    ("Talabat", "talabat", "talabat.jpg"),
    ("Talabya", "talabya", "talabya.jpg"),
    ("Yalla Fel Sekka", "yalla-fel-sekka", "yalla-fel-sekka.jpg"),
    ("ZADNA", "zadna", "zadna.jpg"),
]

DEFAULT_FORM = """[
  {"key":"vehicle","label":"نوع المركبة","type":"select","required":true,"options":["موتوسيكل","سكوتر","عربية","عجلة","بدون مركبة"]},
  {"key":"has_license","label":"معاه رخصة سارية","type":"checkbox"},
  {"key":"age","label":"السن","type":"number"},
  {"key":"experience","label":"خبرة سابقة في التوصيل","type":"textarea"}
]"""


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    out = ["-- Generated by supabase/seed/build_seed.py — do not edit by hand", ""]
    out.append("insert into public.governorates (id, name_ar, name_en) values")
    out.append(",\n".join(f"  ({gid}, {q(ar)}, {q(en)})" for gid, ar, en, _ in GOVERNORATES) + "\non conflict (id) do nothing;\n")

    rows = []
    for gid, _, _, areas in GOVERNORATES:
        for area in areas.split("،"):
            rows.append(f"  ({gid}, {q(area.strip())})")
    out.append("insert into public.regions (governorate_id, name_ar) values")
    out.append(",\n".join(rows) + "\non conflict (governorate_id, name_ar) do nothing;\n")

    out.append("insert into public.companies (name, slug, logo_path, form_schema) values")
    out.append(",\n".join(
        f"  ({q(n)}, {q(s)}, {q('/logos/' + f)}, {q(DEFAULT_FORM)}::jsonb)" for n, s, f in COMPANIES
    ) + "\non conflict (slug) do nothing;\n")

    path = Path(__file__).resolve().parent.parent / "migrations" / "0003_seed.sql"
    path.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {path} ({len(rows)} regions, {len(COMPANIES)} companies)")


if __name__ == "__main__":
    main()
