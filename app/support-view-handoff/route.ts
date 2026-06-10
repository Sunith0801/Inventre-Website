import { NextResponse, type NextRequest } from "next/server";
import {
  SUPPORT_VIEW_COOKIE,
  isSupportViewEnabled,
  verifySupportView,
} from "@/lib/support-view";

/**
 * Support portal redirects the agent's iframe here with a fresh, short-lived
 * JWT. We verify the token, set the same-site cookie on this (storefront)
 * origin, then bounce to the requested path inside /shop. After this, the
 * agent's iframe is same-origin with the cookie and behaves like a real
 * (read-only) parent session.
 */
export async function GET(req: NextRequest) {
  if (!isSupportViewEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  const token = req.nextUrl.searchParams.get("token");
  const next = req.nextUrl.searchParams.get("next") ?? "/shop";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const view = await verifySupportView(token);
  if (!view) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  // Only allow relative redirects.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/shop";

  const target = req.nextUrl.clone();
  target.pathname = safeNext;
  target.search = "";

  const res = NextResponse.redirect(target);
  const ttlSeconds = Math.max(60, view.exp - Math.floor(Date.now() / 1000));
  res.cookies.set(SUPPORT_VIEW_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ttlSeconds,
  });
  return res;
}
