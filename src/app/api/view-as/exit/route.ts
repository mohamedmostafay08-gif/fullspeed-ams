import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { VIEW_AS_COOKIE, getViewAs } from "@/lib/view-as";

/** Leave «شوف كأجنت» and go back to that agent's page in the admin. */
export async function POST(req: NextRequest) {
  const view = await getViewAs();
  if (view) {
    const supabase = await createClient();
    await supabase.rpc("log_view_as", { p_agent: view.agent.id, p_start: false }); // the log is a courtesy here
  }
  const res = NextResponse.redirect(new URL(view ? `/admin/agents/${view.agent.id}` : "/admin", req.url), 303);
  res.cookies.delete(VIEW_AS_COOKIE);
  return res;
}
