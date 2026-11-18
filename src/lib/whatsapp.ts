export type Template = { id: string; title: string; body: string; company_id: string | null };
export type TemplateVars = { name: string; company: string; agent: string; interviewAt?: string; interviewPlace?: string };

/** Placeholders accepted in Arabic or English spelling. */
export const PLACEHOLDERS: [string[], keyof TemplateVars][] = [
  [["الاسم", "name"], "name"],
  [["الشركة", "company"], "company"],
  [["الأجنت", "agent"], "agent"],
  [["ميعاد_المقابلة", "interview_time"], "interviewAt"],
  [["مكان_المقابلة", "interview_place"], "interviewPlace"],
];

export function fillTemplate(body: string, vars: TemplateVars) {
  let out = body;
  for (const [names, key] of PLACEHOLDERS) {
    for (const n of names) out = out.replaceAll(`{${n}}`, vars[key] ?? "—");
  }
  return out;
}

export const waLink = (phone: string, text?: string) =>
  `https://wa.me/2${phone}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

/** Templates for this company first, then the general ones. */
export const templatesFor = (all: Template[], companyId: string) =>
  all.filter((t) => t.company_id === companyId).concat(all.filter((t) => !t.company_id));
