import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth-token";

// Protege todo el panel. La API (/api) valida su propio Bearer token y
// /login queda abierta.
export async function proxy(req: NextRequest) {
  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  const url = new URL("/login", req.url);
  const from = req.nextUrl.pathname + req.nextUrl.search;
  if (from !== "/") url.searchParams.set("from", from);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
