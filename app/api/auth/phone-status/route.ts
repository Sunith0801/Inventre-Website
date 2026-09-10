/**
 * Phone-first login gate. Tells the client which screen to show next.
 *
 *   POST { phone }  →  { registered, hasPassword, firstTime }
 *
 * Policy: firstTime is true ONLY when the family has neither a password
 * on the parent row NOR any verified student. A password OR a verified
 * student is enough to route the user through the normal login screen
 * instead of the first-time setup modal. Previously we required BOTH,
 * which stuck password-set parents on first-time whenever an admin had
 * added new (unverified) students to the family after setup.
 *
 * Case table (this drives client routing):
 *
 *   A. Family parent exists AND has a password
 *      → { registered:true, hasPassword:true, firstTime:false }
 *      Client: password screen (with "Use OTP instead" fallback).
 *      Verified status of the students doesn't matter here.
 *
 *   B. Family parent exists, no password, but at least one student is
 *      verified (unusual edge case — usually means an admin cleared the
 *      password but the family had already finished setup)
 *      → { registered:true, hasPassword:false, firstTime:false }
 *      Client: password screen, where "Use OTP" gets them in.
 *
 *   C. Family parent exists, no password, no verified student
 *      (an unverified row, typically admin-added but never completed
 *      first-time setup)
 *      → { registered:true, hasPassword:false, firstTime:true }
 *      Client: FirstTimeModal — OTP, then create password against the
 *      existing parent row.
 *
 *   D. No family parent yet, but this phone is on an unclaimed student's
 *      guardian links (fresh family)
 *      → { registered:true, hasPassword:false, firstTime:true }
 *      Client: FirstTimeModal — OTP, set password, and this phone becomes
 *      the new primary on completion.
 *
 *   E. Phone doesn't appear anywhere
 *      → { registered:false }
 *      Client: unknown-phone recovery panel.
 *
 * Family-parent resolution uses lib/parent-lookup.resolveFamilyParent
 * which walks the multi-guardian student graph first, then falls back to
 * exact phone match (ignoring zombie rows that own no students). This
 * ensures a second guardian on an already-claimed family is correctly
 * routed to Case A/B/C instead of being dead-ended.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimit } from "@/server/rate-limit";
import { last10Sql } from "@/lib/phone";
import { resolveFamilyParent, familyHasVerifiedStudent } from "@/server/parent-lookup";

const Body = z.object({ phone: z.string().regex(/^\d{10}$/) });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `phone-status:${ip}`,
    max: 60,
    windowSeconds: 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 }
    );
  }

  // OTP_TEST_BYPASS=1: let any phone through for staging/demo testing.
  if (process.env.OTP_TEST_BYPASS === "1") {
    return NextResponse.json({
      registered: true,
      hasPassword: false,
      firstTime: true,
    });
  }

  // Case A / B / C — a real family parent exists for this phone.
  // hasPassword reports password availability only (drives the password
  // screen). firstTime is the stricter "both missing" predicate — only
  // route to the first-time-setup modal when there's nothing to log in
  // with (no password) AND no proof the family has ever finished setup
  // (no verified student).
  const primary = await resolveFamilyParent(body.phone);
  if (primary) {
    const verified = await familyHasVerifiedStudent(primary.id);
    const hasPassword = !!primary.passwordHash;
    const firstTime = !hasPassword && !verified;
    return NextResponse.json({
      registered: true,
      hasPassword,
      firstTime,
    });
  }

  // Case C — no family parent yet, but this phone is on an unclaimed
  // student's guardian links. FirstTimeModal will turn this into the
  // family's primary on completion.
  const unclaimed = (await db.execute(sql`
    SELECT 1
      FROM students s
      LEFT JOIN student_guardian_links sgl ON sgl.student_id = s.id
      LEFT JOIN guardians g ON g.erp_name = sgl.guardian_erp_name
     WHERE s.parent_id IS NULL
       AND (
         ${last10Sql(sql`sgl.phone_no`)} = ${body.phone}
         OR ${last10Sql(sql`g.mobile_number`)} = ${body.phone}
         OR ${last10Sql(sql`g.alternate_number`)} = ${body.phone}
       )
     LIMIT 1
  `)) as unknown as unknown[];
  if (unclaimed.length > 0) {
    return NextResponse.json({
      registered: true,
      hasPassword: false,
      firstTime: true,
    });
  }

  // Case D — unknown phone.
  return NextResponse.json({
    registered: false,
    hasPassword: false,
    firstTime: false,
  });
}
