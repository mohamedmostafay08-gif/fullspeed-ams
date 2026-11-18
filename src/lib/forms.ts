import type { FieldType, FormField } from "@/lib/types";

const FIELD_TYPES: FieldType[] = ["text", "number", "phone", "date", "select", "checkbox", "textarea"];

export function normalizePhone(raw: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  let p = raw.replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d))).replace(/[^\d+]/g, "");
  if (p.startsWith("+20")) p = "0" + p.slice(3);
  else if (p.startsWith("0020")) p = "0" + p.slice(4);
  else if (p.startsWith("20") && p.length === 12) p = "0" + p.slice(2);
  else if (/^1\d{9}$/.test(p)) p = "0" + p;
  return p;
}

export function isValidEgyptMobile(phone: string): boolean {
  return /^01[0125]\d{8}$/.test(phone);
}

/** Validates an admin-edited form schema; throws with an Arabic message on bad input. */
export function parseSchema(json: string): FormField[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("صيغة الفورم غير صحيحة");
  }
  if (!Array.isArray(raw)) throw new Error("صيغة الفورم غير صحيحة");
  const keys = new Set<string>();
  return raw.map((f, i) => {
    const label = String(f?.label ?? "").trim();
    const type = f?.type as FieldType;
    if (!label) throw new Error(`الحقل رقم ${i + 1} من غير اسم`);
    if (!FIELD_TYPES.includes(type)) throw new Error(`نوع الحقل "${label}" غير معروف`);
    let key = String(f?.key ?? "").trim() || `field_${i + 1}`;
    key = key.replace(/[^a-zA-Z0-9_]/g, "_");
    if (["full_name", "phone", "governorate_id", "region_id"].includes(key) || keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const field: FormField = { key, label, type, required: Boolean(f?.required) };
    if (type === "select") {
      const options = (Array.isArray(f?.options) ? f.options : []).map((o: unknown) => String(o).trim()).filter(Boolean);
      if (options.length === 0) throw new Error(`الحقل "${label}" محتاج اختيارات`);
      field.options = options;
    }
    return field;
  });
}

/** Reads company-specific answers out of a submitted form; returns errors keyed by field. */
export function readCustomFields(schema: FormField[], form: FormData) {
  const data: Record<string, string | number | boolean> = {};
  const errors: string[] = [];
  for (const field of schema) {
    const name = `f_${field.key}`;
    if (field.type === "checkbox") {
      data[field.key] = form.get(name) === "on";
      continue;
    }
    const value = String(form.get(name) ?? "").trim();
    if (!value) {
      if (field.required) errors.push(`${field.label} مطلوب`);
      continue;
    }
    if (field.type === "number") {
      const n = Number(value);
      if (Number.isNaN(n)) errors.push(`${field.label} لازم يكون رقم`);
      else data[field.key] = n;
    } else if (field.type === "select" && !field.options?.includes(value)) {
      errors.push(`اختيار غير صحيح في ${field.label}`);
    } else if (field.type === "phone") {
      data[field.key] = normalizePhone(value);
    } else {
      data[field.key] = value.slice(0, 2000);
    }
  }
  return { data, errors };
}

export function formatFieldValue(field: FormField | undefined, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field?.type === "checkbox" || typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}
