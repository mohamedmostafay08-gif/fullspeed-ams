import "server-only";
import type { FieldType, FormField } from "@/lib/types";

// Fields every lead form already has — imported duplicates are dropped.
const BUILT_IN = /^(الاسم|اسم|الاسم بالكامل|الاسم رباعي|الاسم الثلاثي|name|full name|رقم الموبايل|الموبايل|رقم التليفون|التليفون|رقم الهاتف|phone|mobile|المحافظة|محافظة|governorate|المنطقة|منطقة|region|area)$/i;

const TYPE_HINTS: [RegExp, FieldType][] = [
  [/\((?:رقم|number|عدد)\)/i, "number"],
  [/\((?:تاريخ|date)\)/i, "date"],
  [/\((?:نعم\s*\/\s*لا|yes\s*\/\s*no|اختيار نعم ولا)\)/i, "checkbox"],
  [/\((?:موبايل|تليفون|phone)\)/i, "phone"],
  [/\((?:نص طويل|ملاحظات|long|paragraph)\)/i, "textarea"],
];

const LABEL_GUESS: [RegExp, FieldType][] = [
  [/^(السن|العمر|age)$/i, "number"],
  [/(تاريخ|date of)/i, "date"],
  [/(رقم (موبايل|تليفون) (تاني|آخر|اخر|إضافي)|واتساب|whatsapp)/i, "phone"],
  [/^(هل|عندك|معاك|معاه)\s/, "checkbox"],
  [/(ملاحظات|خبرة سابقة|عنوان تفصيلي)/, "textarea"],
];

function clean(label: string) {
  return label.replace(/\s+/g, " ").replace(/[*:：]+$/g, "").trim();
}

/** One field per line. "*" marks required; "Label: a، b، c" becomes a list; "(رقم)" etc. sets the type. */
export function parseFormText(text: string): FormField[] {
  const fields: FormField[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:[-•▪●]|\d+[.)-])\s*/, "").trim();
    if (!line) continue;
    const required = /\*/.test(line);
    line = line.replace(/\*/g, "").trim();

    let type: FieldType = "text";
    for (const [re, t] of TYPE_HINTS) {
      if (re.test(line)) {
        type = t;
        line = line.replace(re, "").trim();
      }
    }

    let options: string[] | undefined;
    const sep = line.match(/^([^:：=]+)[:：=](.+)$/);
    if (sep) {
      const parts = sep[2].split(/[،,/|؛;]/).map((o) => o.trim()).filter(Boolean);
      if (parts.length >= 2) {
        options = [...new Set(parts)].slice(0, 50);
        type = "select";
        line = sep[1];
      }
    }

    const label = clean(line).slice(0, 80);
    if (!label || BUILT_IN.test(label)) continue;
    if (type === "text") for (const [re, t] of LABEL_GUESS) if (re.test(label)) { type = t; break; }
    fields.push({ key: "", label, type, required, ...(options ? { options } : {}) });
  }
  return fields.slice(0, 60);
}

// Google Forms embeds its questions as JSON in FB_PUBLIC_LOAD_DATA_.
const GOOGLE_TYPES: Record<number, FieldType | null> = {
  0: "text", 1: "textarea", 2: "select", 3: "select", 4: "select", 5: "number", 7: null, 9: "date", 10: "text",
};

export async function parseGoogleForm(input: string): Promise<FormField[]> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("اللينك مش صحيح");
  }
  const allowed = (u: URL) => u.protocol === "https:" && (u.hostname === "docs.google.com" || u.hostname === "forms.gle");
  if (!allowed(url)) throw new Error("ابعت لينك Google Form (docs.google.com/forms أو forms.gle)");

  let html = "";
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "accept-language": "ar,en" } });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url);
      if (!allowed(url)) throw new Error("اللينك بيحوّل لمكان مش Google Forms");
      continue;
    }
    if (!res.ok) throw new Error("مقدرتش أفتح الفورم — اتأكد إنها Public ومش محتاجة تسجيل دخول");
    html = await res.text();
    break;
  }

  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]+?);\s*<\/script>/);
  if (!m) throw new Error("مقدرتش أقرا أسئلة الفورم — اتأكد إن الفورم مفتوحة للكل");
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error("صيغة الفورم مش مفهومة");
  }

  const items = ((data as unknown[])?.[1] as unknown[])?.[1] as unknown[] | undefined;
  if (!Array.isArray(items)) throw new Error("الفورم فاضية");
  const fields: FormField[] = [];
  for (const item of items) {
    if (!Array.isArray(item)) continue;
    const title = typeof item[1] === "string" ? clean(item[1]) : "";
    const type = GOOGLE_TYPES[item[3] as number];
    if (!title || !type || BUILT_IN.test(title)) continue;
    const answer = Array.isArray(item[4]) ? (item[4][0] as unknown[]) : null;
    const required = Boolean(answer?.[2]);
    const options = Array.isArray(answer?.[1])
      ? (answer![1] as unknown[]).map((o) => (Array.isArray(o) ? String(o[0] ?? "").trim() : "")).filter(Boolean)
      : [];
    if (type === "select" && options.length === 0) continue;
    fields.push({ key: "", label: title.slice(0, 80), type, required, ...(type === "select" ? { options: options.slice(0, 50) } : {}) });
  }
  if (fields.length === 0) throw new Error("ملقتش أسئلة غير الاسم والموبايل");
  return fields;
}
