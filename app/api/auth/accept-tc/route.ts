/**
 * Per-login T&C acceptance endpoint.
 *
 * Called by TermsAcceptanceModal after every non-first-time login
 * (password, OTP, recovery). Persists the acceptance against the parent
 * row so we have an audit trail of which policy version each session
 * acknowledged. Idempotent — multiple calls in the same session just
 * keep bumping tc_accepted_at.
 *
 *   POST { version }  →  { ok: true }
 *
 * Auth: parent session required. We use getCurrentParent (not
 * getCurrentUser) so a shadowing admin cookie in the same browser
 * doesn't 401 a legitimate parent acceptance — same pattern as
 * /api/auth/me and /api/auth/change-phone/*.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { getCurrentParent } from "@/server/session";
import { parseJson } from "@/server/api-handler";
import { TC_VERSION } from "@/lib/legal/terms";

const Body = z.object({
  version: z.string().min(1, "Acceptance version is required."),
});

export async function POST(req: Request) {
  const me = await getCurrentParent();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  // Reject stale clients that submit an older policy string than the
  // current TC_VERSION — forces them to reload and see the latest text
  // before we record acceptance.
  if (body.version !== TC_VERSION) {
    return NextResponse.json(
      {
        error:
          "Our Terms & Conditions have been updated. Please reload the page and accept the latest version.",
      },
      { status: 409 }
    );
  }

  await db
    .update(parents)
    .set({
      tcAcceptedAt: new Date(),
      tcAcceptedVersion: body.version,
    })
    .where(eq(parents.id, me.id));

  return NextResponse.json({ ok: true });
}
