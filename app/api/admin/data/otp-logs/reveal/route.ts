import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { otpLogs } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { parseJson } from "@/server/api-handler";
import { logAdminActivity } from "@/server/activity";
import { rateLimit } from "@/server/rate-limit";
import { checkRevealPhrase, openOtpCode, revealEnabled } from "@/server/otp-log-crypto";

/**
 * POST /api/admin/data/otp-logs/reveal  { id, phrase }
 *
 * Shows ONE stored OTP code to a staff member who (a) holds otp-logs.write,
 * (b) types the OTP_REVEAL_PHRASE, and (c) has not exceeded 5 reveals per
 * 10 minutes. Every reveal is written to the activity log (P-01).
 */
const Body = z.object({ id: z.string().uuid(), phrase: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const me = await requirePermission("otp-logs.write");
  if (isResponse(me)) return me;

  if (!revealEnabled()) {
    return NextResponse.json({ error: "Reveal is not enabled on this server (OTP_LOG_KEY / OTP_REVEAL_PHRASE)." }, { status: 503 });
  }

  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  const rl = await rateLimit({ key: `otp-reveal:${me.id}`, max: 5, windowSeconds: 600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many reveals. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  if (!checkRevealPhrase(body.phrase)) {
    await logAdminActivity(me, {
      action: "otp.reveal_denied",
      entityType: "otp_log",
      entityId: body.id,
      summary: "Wrong OTP reveal phrase",
      req,
    });
    return NextResponse.json({ error: "Wrong key phrase." }, { status: 403 });
  }

  const [row] = await db
    .select({ id: otpLogs.id, phone: otpLogs.phone, otpCode: otpLogs.otpCode, createdAt: otpLogs.createdAt })
    .from(otpLogs)
    .where(eq(otpLogs.id, body.id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const code = openOtpCode(row.otpCode);
  await logAdminActivity(me, {
    action: "otp.reveal",
    entityType: "otp_log",
    entityId: row.id,
    summary: `Revealed OTP sent to +91 ${row.phone} at ${row.createdAt.toISOString()}`,
    req,
  });

  return NextResponse.json({ ok: true, code: code ?? null, unavailable: code == null });
}
