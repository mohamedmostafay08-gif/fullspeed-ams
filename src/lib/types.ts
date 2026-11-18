export type Role = "admin" | "manager" | "team_leader" | "agent";
export type LeadStatus = "new" | "no_answer" | "contacted" | "interview" | "documents" | "hired" | "rejected";
export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high";
export type NotificationType = "bonus" | "rate" | "task" | "assignment" | "lead" | "info" | "break" | "reminder";
export type BreakStatus = "pending" | "active" | "ended" | "rejected" | "cancelled";

export type FieldType = "text" | "number" | "phone" | "date" | "select" | "checkbox" | "textarea";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  team_id: string | null;
  is_active: boolean;
  location_id: string | null;
  allow_anywhere: boolean;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
  description: string | null;
  form_schema: FormField[];
  is_active: boolean;
}

export interface Governorate {
  id: number;
  name_ar: string;
  name_en?: string | null;
}

/** Governorate name in the viewer's language (regions only have Arabic names). */
export const placeName = (g: { name_ar: string; name_en?: string | null } | null | undefined, locale: string) =>
  g ? (locale === "en" && g.name_en ? g.name_en : g.name_ar) : null;

export interface Region {
  id: number;
  governorate_id: number;
  name_ar: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "أدمن",
  manager: "مدير أكوزيشن",
  team_leader: "تيم ليدر",
  agent: "أجنت",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "جديد",
  no_answer: "مردش",
  contacted: "تم التواصل",
  interview: "مقابلة",
  documents: "استلام أوراق",
  hired: "اشتغل",
  rejected: "مرفوض",
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-sky-100 text-sky-800",
  no_answer: "bg-zinc-200 text-zinc-700",
  contacted: "bg-indigo-100 text-indigo-800",
  interview: "bg-amber-100 text-amber-800",
  documents: "bg-violet-100 text-violet-800",
  hired: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "لم يبدأ",
  in_progress: "جاري",
  done: "تم",
  cancelled: "ملغي",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "عادي",
  medium: "متوسط",
  high: "عاجل",
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "نص",
  number: "رقم",
  phone: "تليفون",
  date: "تاريخ",
  select: "اختيار من قائمة",
  checkbox: "نعم / لا",
  textarea: "نص طويل",
};

export const DOC_KINDS = {
  id_front: "البطاقة (وش)",
  id_back: "البطاقة (ضهر)",
  license: "رخصة القيادة",
  vehicle_license: "رخصة المركبة",
  photo: "صورة شخصية",
  criminal_record: "فيش جنائي",
  other: "أخرى",
} as const;

/** Who may give which role: only an admin creates admins and managers; a manager adds team leaders and agents. */
export function assignableRoles(myRole: Role): Role[] {
  if (myRole === "admin") return ["admin", "manager", "team_leader", "agent"];
  if (myRole === "manager") return ["team_leader", "agent"];
  return [];
}

/** Whether `myRole` may edit an account that currently has `targetRole`. */
export const canManageRole = (myRole: Role, targetRole: Role) => myRole === "admin" || (myRole === "manager" && (targetRole === "team_leader" || targetRole === "agent"));
