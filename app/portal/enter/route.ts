import { NextResponse } from "next/server";
import { verifyPortalToken } from "@/server/portal-token";
import { createParentSession } from "@/server/session";

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
  // Behind nginx the request URL's host is the internal bind (0.0.0.0:3000),
  // so build the public origin from the forwarded headers — otherwise the
  // browser gets redirected to a dead 0.0.0.0 URL.
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const base = `${proto}://${host}`;

  const parentId = verifyPortalToken(url.searchParams.get("t"));
  if (!parentId) {
    return NextResponse.redirect(`${base}/login?next=/portal`);
  }
  // Establish the parent session, then land on the clean /portal URL (drops
  // the token from the address bar / history).
  await createParentSession(parentId);
  return NextResponse.redirect(`${base}/portal`);
}
