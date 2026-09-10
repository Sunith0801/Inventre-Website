import { NextResponse, type NextRequest } from "next/server";
import { SUPPORT_VIEW_COOKIE, verifySupportView } from "@/server/support-view";
import { logActivity } from "@/server/activity";

/**
 * Agent-facing "Exit read-only view" — clears the support-view cookie and
 * drops the agent back into their own session.
 *
 * GET, not POST: the cookie is httpOnly, so only a top-level navigation can
 * carry and clear it, and a plain anchor in the banner works without JS.
 * Clearing your own cookie is not a state change worth CSRF protection — the
 * worst a forged request can do is end an impersonation early, which is the
 * safe direction to fail.
 *
 * The cookie is set with maxAge (a *persistent* cookie), so it survives a tab
 * close and there is otherwise no way out before the token expires. This route
 * is the only escape hatch.
 *
 * Note this path is outside middleware's config.matcher, so the read-only
 * guard never runs here — this route must stand on its own.
 *
 * The agent's own inv_session cookie is never touched: support view uses a
 * separate cookie name, so their real session is intact underneath and simply
 * stops being shadowed once this one is gone.
 */
export async function GET(req: NextRequest) {
  // Deliberately not gated on isSupportViewEnabled(): if the feature is turned
  // off while sessions are live, agents must still be able to clear the cookie.
  const token = req.cookies.get(SUPPORT_VIEW_COOKIE)?.value;

  const fwdProto = req.headers.get("x-forwarded-proto");
  const fwdHost = req.headers.get("x-forwarded-host");
  const base = (
    process.env.SUPPORT_VIEW_BASE_URL ||
    `${fwdProto ?? req.nextUrl.protocol.replace(/:$/, "")}://${
      fwdHost ?? req.nextUrl.host
    }`
  ).replace(/\/+$/, "");
  const target = new URL("/support-view/ended?reason=exit", base);

  const res = NextResponse.redirect(target);
  // Mirror the attributes used at set time (support-view-handoff) so the
  // browser actually matches and evicts the cookie.
  res.cookies.set(SUPPORT_VIEW_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: target.protocol === "https:",
    path: "/",
    maxAge: 0,
  });

  if (token) {
    const view = await verifySupportView(token);
    if (view) {
      await logActivity({
        action: "support.view.exit",
        actorRole: "support",
        actorName: view.agentName || view.agentId,
        entityType: "parent",
        entityId: view.parentId,
        summary: `Support view-as ended by agent for parent ${view.parentId}`,
        remarks: `agent=${view.agentId} session=${view.supportSessionId} jti=${view.jti}`,
      });
    }
  }

  return res;
}
