import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VIEW_AS_COOKIE, VIEW_AS_ROLES } from "@/lib/view-as";

const UUID = /^[0-9a-f-]{36}$/i;

function back(req: NextRequest, error: string) {
  const url = new URL("/admin/view-as", req.url);
  url.searchParams.set("e", error);
  return NextResponse.redirect(url, 303);
}

/** Start «شوف كأجنت»: admin only, logged in the activity log, then open the agent's home. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new NextResponse("bad origin", { status: 403 });
  const me = await getProfile();
  if (!me || !VIEW_AS_ROLES.includes(me.role)) return NextResponse.redirect(new URL("/", req.url), 303);

  const agent = String((await req.formData()).get("agent") ?? "");
  if (!UUID.test(agent)) return back(req, "اختار أجنت الأول");

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_view_as", { p_agent: agent, p_start: true });
  if (error) {
    if (error.message.includes("view_as_not_agent")) return back(req, "الحساب ده مش أجنت");
    if (error.code === "PGRST202" || error.message.includes("log_view_as"))
      return back(req, "لازم تشغّل migration 0053_view_as_agent في Supabase الأول");
    return back(req, error.message);
  }

  const res = NextResponse.redirect(new URL("/agent", req.url), 303);
  res.cookies.set(VIEW_AS_COOKIE, `${me.id}:${agent}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
