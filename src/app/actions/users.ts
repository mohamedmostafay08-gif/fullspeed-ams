"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const ids = (form: FormData) => [...new Set(form.getAll("user_id").map(String))].filter((v) => UUID_RE.test(v));

type T = Awaited<ReturnType<typeof getT>>;

function dbError(t: T, e: { code?: string; message: string }): ActionState {
  const m = e.message;
  if (e.code === "PGRST202" || /set_users_active|force_sign_out_many|user_overview/.test(m)) return { error: t("لازم migration 0056 تتطبق في Supabase الأول") };
  if (m.includes("admin_only")) return { error: t("ده للأدمن بس") };
  if (m.includes("no_users")) return { error: t("اختار موظف واحد على الأقل (غيرك)") };
  if (m.includes("too_many")) return { error: t("أقصى 500 موظف في المرة") };
  if (m.includes("transfer_to_suspended")) return { error: t("مينفعش تنقل الليدز لحد بيتوقف معاهم") };
  if (m.includes("transfer_to_invalid")) return { error: t("اللي هتنقله الليدز لازم يكون أجنت نشط") };
  return { error: m };
}

/** Suspend or reactivate one or many users. Suspending ends their sessions and can move their open leads. */
async function setActive(t: T, users: string[], active: boolean, form: FormData): Promise<ActionState> {
  const transfer = str(form, "transfer_to");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_users_active", {
    p_users: users,
    p_active: active,
    p_transfer_to: !active && UUID_RE.test(transfer) ? transfer : null,
    p_unassign: !active && transfer === "pool",
  });
  if (error) return dbError(t, error);
  const r = (data ?? {}) as { changed?: number; leads_moved?: number };
  revalidatePath("/admin", "layout");
  const moved = r.leads_moved ? t(" · واتنقل {0} ليد", r.leads_moved) : "";
  return { ok: active ? t("اتفعّل {0} حساب ✓", r.changed ?? 0) : t("اتوقف {0} حساب واتطلّعوا من كل الأجهزة ✓{1}", r.changed ?? 0, moved) };
}

async function signOutAll(t: T, users: string[]): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("force_sign_out_many", { p_users: users });
  if (error) return dbError(t, error);
  revalidatePath("/admin", "layout");
  return { ok: t("اتقفل {0} جهاز ✓ — هيحتاجوا يدخلوا تاني", Number(data ?? 0)) };
}

/** The control card on a user's page: suspend / reactivate / sign out everywhere. */
export async function controlUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole("admin");
  const id = str(form, "user_id");
  if (!UUID_RE.test(id)) return { error: t("بيانات غلط — اعمل refresh وجرّب تاني") };
  if (id === me.id) return { error: t("مينفعش تعمل كده على حسابك") };
  const op = str(form, "op");
  if (op === "suspend") return setActive(t, [id], false, form);
  if (op === "activate") return setActive(t, [id], true, form);
  if (op === "signout") return signOutAll(t, [id]);
  return { error: t("اختار الأكشن") };
}

/** The bulk bar on the team page: the ticked users, one action. */
export async function bulkUsers(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole("admin");
  const users = ids(form).filter((u) => u !== me.id);
  if (users.length === 0) return { error: t("علّم على موظف واحد على الأقل (غيرك)") };
  const op = str(form, "op");
  if (op === "suspend") return setActive(t, users, false, form);
  if (op === "activate") return setActive(t, users, true, form);
  if (op === "signout") return signOutAll(t, users);

  const supabase = await createClient();
  if (op === "team") {
    const team = str(form, "team_id");
    if (team && team !== "none" && !UUID_RE.test(team)) return { error: t("اختار التيم") };
    if (!team) return { error: t("اختار التيم") };
    const { error } = await supabase.from("profiles").update({ team_id: team === "none" ? null : team }).in("id", users);
    if (error) return { error: error.message };
    revalidatePath("/admin", "layout");
    return { ok: t("اتنقل {0} موظف ✓", users.length) };
  }

  if (op === "add_company" || op === "remove_company") {
    const company = str(form, "company_id");
    if (!UUID_RE.test(company)) return { error: t("اختار الشركة") };
    const [{ data: people, error: pErr }, { data: rows, error: aErr }] = await Promise.all([
      supabase.from("profiles").select("id, role").in("id", users),
      supabase.from("agent_companies").select("agent_id, company_id").in("agent_id", users),
    ]);
    if (pErr || aErr) return { error: (pErr ?? aErr)!.message };
    const agents = (people ?? []).filter((p) => p.role === "agent").map((p) => p.id);
    if (agents.length === 0) return { error: t("الشركات بتتعيّن للأجنتس بس — مفيش أجنت في اللي علّمت عليهم") };
    const current = new Map<string, Set<string>>(agents.map((a) => [a, new Set()]));
    for (const r of rows ?? []) current.get(r.agent_id)?.add(r.company_id);
    const changes = agents
      .filter((a) => (op === "add_company") !== current.get(a)!.has(company))
      .map((a) => {
        const s = new Set(current.get(a));
        if (op === "add_company") s.add(company); else s.delete(company);
        return { agent_id: a, company_ids: [...s] };
      });
    if (changes.length === 0) return { ok: t("مفيش تغييرات تتحفظ") };
    const { error } = await supabase.rpc("set_agent_companies", { p_changes: changes });
    if (error) return { error: error.message };
    revalidatePath("/admin", "layout");
    return { ok: op === "add_company" ? t("الشركة اتضافت لـ {0} أجنت ✓", changes.length) : t("الشركة اتشالت من {0} أجنت ✓", changes.length) };
  }
  return { error: t("اختار الأكشن") };
}
