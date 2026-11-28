import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { VIEW_AS_COOKIE, VIEW_AS_READ_ONLY, parseViewAs } from "@/lib/view-as-cookie";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!signedIn && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // «شوف كأجنت» is read-only: no form, server action or API write from the agent pages while it's on.
  // The cookie only counts for the admin who started it; on anyone else's session it is dropped.
  const viewAs = parseViewAs(request.cookies.get(VIEW_AS_COOKIE)?.value);
  if (request.cookies.has(VIEW_AS_COOKIE) && (!viewAs || viewAs.viewer !== data?.claims?.sub)) {
    response.cookies.delete(VIEW_AS_COOKIE);
  } else if (
    viewAs &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    (pathname.startsWith("/agent") || pathname.startsWith("/api/")) &&
    !pathname.startsWith("/api/view-as")
  ) {
    return new NextResponse(VIEW_AS_READ_ONLY, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (signedIn && pathname === "/login" && !request.nextUrl.searchParams.has("e")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/crm|api/meta/webhook|api/linecrm/webhook|api/linecrm/recheck|api/linecrm/pull|api/push/dispatch|api/backup/run|api/whatsapp/welcome|api/whatsapp/reminder|privacy$|_next/static|_next/image|favicon.ico|logos/|icons/|sw\\.js|manifest\\.webmanifest|offline\\.html|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)"],
};
