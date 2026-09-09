import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/jwt";

export const dynamic = "force-dynamic";

/**
 * Escape hatch for a fee-desk account holding a stale admin cookie.
 *
 * Fee-ledger accounts stopped being issued admin cookies on 2026-08-27
 * (app/api/admin/auth/login/route.ts refuses them), but admin sessions last
 * 7 days, so cookies minted before that kept arriving. Such a session used
 * to bounce /admin → /fees → /fees/login with nothing cleared: the cookie
 * survived, so every later visit to /admin repeated the loop and the real
 * admin sign-in page was never reachable by typing /admin.
 *
 * The layout sends those sessions here instead. We clear the admin cookie —
 * it grants nothing this account may use — and hand the browser to the fee
 * ledger's own door, flagged so the page can say what happened. Anyone who
 * actually wanted /admin can now sign in there normally.
 */
export async function GET() {
  // A RELATIVE Location, not NextResponse.redirect(new URL(..., req.url)):
  // behind nginx `req.url` is the container's own origin, so that form
  // hands the browser http://0.0.0.0:3000/… and the redirect dead-ends.
  // A relative target (RFC 7231 §7.1.2) resolves against whatever host the
  // user actually typed.
  const res = new NextResponse(null, {
    status: 307,
    headers: { Location: "/fees/login?from=%2Ffees&stale_admin=1" },
  });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
