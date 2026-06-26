import { NextResponse } from "next/server";
import { verifyPortalToken } from "@/lib/portal-token";
import { createParentSession } from "@/lib/session";

/**
 * Magic-link entry for the Parent Help Portal.
 *
 *   GET /portal/enter?t=<token>
 *
 * The QR on a parent's package points here. A valid token establishes that
 * parent's session (no login prompt) and lands on /portal. An invalid or
 * expired token falls back to the normal login (so the link still "works",
 * just asks them to sign in). The token is single-purpose proof-of-parent;
 * see lib/portal-token.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parentId = verifyPortalToken(url.searchParams.get("t"));
  if (!parentId) {
    return NextResponse.redirect(new URL("/login?next=/portal", url.origin));
  }
  // Establish the parent session, then land on the clean /portal URL (drops
  // the token from the address bar / history).
  await createParentSession(parentId);
  return NextResponse.redirect(new URL("/portal", url.origin));
}
