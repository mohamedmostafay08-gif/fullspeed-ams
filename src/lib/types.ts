export type Role = "admin" | "manager" | "team_leader" | "agent" | "performance";
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
  salary?: string | null;
  order_price?: string | null;
  working_hours?: string | null;
  terms?: { label: string; value: string }[] | null;
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
  performance: "متابعة الأداء",
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

/** A glanceable emoji next to each lead status. */
export const LEAD_STATUS_EMOJI: Record<LeadStatus, string> = {
  new: "🆕",
  no_answer: "📵",
  contacted: "📞",
  interview: "🤝",
  documents: "📄",
  hired: "🎉",
  rejected: "🚫",
};

export const ROLE_EMOJI: Record<string, string> = {
  admin: "👑",
  manager: "🧭",
  team_leader: "⭐",
  agent: "🎧",
  performance: "📊",
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

/** Who may give which role: only an admin creates admins and managers; a manager adds team leaders and
 * agents; a team leader adds agents to their own team. */
export function assignableRoles(myRole: Role): Role[] {
  if (myRole === "admin") return ["admin", "manager", "performance", "team_leader", "agent"];
  if (myRole === "manager") return ["team_leader", "agent"];
  if (myRole === "team_leader") return ["agent"];
  return [];
}

/** Whether `myRole` may edit an account that currently has `targetRole`. */
export const canManageRole = (myRole: Role, targetRole: Role) => myRole === "admin" || (myRole === "manager" && (targetRole === "team_leader" || targetRole === "agent"));

/** "تيم X" for a team name, unless the name already starts with the word. */
export const teamLabel = (name: string, t: (s: string, ...a: (string | number)[]) => string) =>
  /^\s*(تيم|team)(?=\s|$)/i.test(name) ? name : t("تيم {0}", name);

/** Why a captain was rejected; the agent picks one when logging the call. */
export const REJECT_REASONS = {
  salary: "المرتب أو التعريفة مش مناسبين",
  no_vehicle: "معندوش مركبة أو رخصة",
  far: "المكان بعيد عنه",
  age: "السن مش مناسب",
  not_interested: "مش مهتم / غيّر رأيه",
  other_job: "اشتغل في مكان تاني",
  documents: "الأوراق ناقصة",
  no_show: "مجاش المقابلة",
  other: "سبب تاني",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;

/** Where a lead came from. */
export const LEAD_SOURCES: Record<string, string> = {
  manual: "إدخال يدوي",
  facebook: "فيسبوك",
  tiktok: "تيك توك",
  referral: "ترشيح",
  walk_in: "حضور للمقر",
  import: "ملف Excel",
  crm: "CRM",
  whatsapp: "واتساب",
};
