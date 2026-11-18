import { DYNAMIC_EN, EN } from "./en";

export type Locale = "ar" | "en";
export type Arg = string | number | null | undefined;
/** Arabic source text is the key; English comes from the dictionary. `{0}`, `{1}`… are filled from args. */
export type T = (text: string, ...args: Arg[]) => string;

export function makeT(locale: Locale): T {
  return (text, ...args) => {
    let out = locale === "en" ? (EN[text] ?? translateDynamic(text)) : text;
    args.forEach((a, i) => {
      out = out.replaceAll(`{${i}}`, a == null ? "" : String(a));
    });
    return out;
  };
}

// Validation messages built around a field label, and currency inside free text.
const PATTERNS: [RegExp, string][] = [
  [/اختيار غير صحيح في ([^،·]+)/g, "Invalid choice in $1"],
  [/([^،·]+?) لازم يكون رقم/g, "$1 must be a number"],
  [/([^،·]+?) مطلوب/g, "$1 is required"],
  [/الحقل رقم (\d+) من غير اسم/g, "Field #$1 has no name"],
  [/نوع الحقل "([^"]+)" غير معروف/g, 'Unknown type for field "$1"'],
  [/الحقل "([^"]+)" محتاج اختيارات/g, 'Field "$1" needs choices'],
  [/، /g, ", "],
  [/ج\.م/g, "EGP"],
];

/** Database-generated Arabic texts (notification titles etc.) built from a fixed prefix + a variable part. */
function translateDynamic(text: string): string {
  for (const [ar, en] of DYNAMIC_EN) {
    if (text.startsWith(ar)) return en + text.slice(ar.length);
  }
  return PATTERNS.reduce((s, [re, en]) => s.replace(re, en), text);
}

export const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");
