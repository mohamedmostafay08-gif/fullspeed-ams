import type { T } from "@/lib/i18n/translate";

/** What a status rule may require before a lead enters that status (mirrors lead_rule_fields() in migrations 0051 and 0060). */
export const RULE_FIELDS = {
  interview_at: "معاد المقابلة",
  callback_at: "معاد مكالمة",
  governorate_id: "المحافظة",
  region_id: "المنطقة",
  notes: "ملاحظة",
  reject_reason: "سبب الرفض",
  vehicle: "نوع المركبة",
  has_license: "الرخصة",
  age: "السن",
} as const;
export type RuleField = keyof typeof RULE_FIELDS;


/** The database says «REQUIRED:a,b» when a status rule blocks a change: name the missing fields. */
export function requiredFieldsError(t: T, message: string | undefined): string | null {
  const m = /REQUIRED:([a-z_,]+)/.exec(message ?? "");
  if (!m) return null;
  const names = m[1].split(",").map((k) => t(RULE_FIELDS[k as RuleField] ?? k));
  return t("الحالة دي محتاجة الأول: {0}", names.join("، "));
}
