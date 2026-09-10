import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { sendSms, generateOtp } from "@/server/notify/sms";
import { getCurrentParent } from "@/server/session";
import { parseJson } from "@/server/api-handler";

const Body = z.object({
  newPhone: z.string().regex(/^\d{10}$/),
});

const OTP_TTL = 5 * 60;

export async function POST(req: Request) {
  // Use the parent-preferred resolver — getCurrentUser() would pick the
  // admin cookie first, so a user with both admin and parent sessions in
  // the same browser would 401 here even though they ARE a logged-in
  // parent. /api/auth/me uses the same parent-preferred pattern.
  const me = await getCurrentParent();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  if (body.newPhone === me.phone) {
    return NextResponse.json(
      { error: "This is already your current number." },
      { status: 400 }
    );
  }

  // Cap how often a parent can request phone-change OTPs.
  const rl = await rateLimit({
    key: `chg-phone:req:${me.id}`,
    max: 3,
    windowSeconds: 10 * 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a few minutes." },
      { status: 429 }
    );
  }

  // Block only when another *real* parent (one that owns at least one
  // student) holds the new number. Empty "zombie" parent rows — typically
  // left behind by the multi-guardian OTP login auto-creating a parent for
  // a stale guardian master — are silently reclaimed so the change can
  // proceed. Mirrors recover/request-new-otp's behaviour.
  const taken = (await db.execute(sql`
    SELECT p.id,
           EXISTS (SELECT 1 FROM students WHERE parent_id = p.id) AS has_student
      FROM parents p
     WHERE p.phone = ${body.newPhone}
       AND p.id <> ${me.id}
     LIMIT 1
  `)) as unknown as { id: string; has_student: boolean }[];
  const occ = Array.isArray(taken) ? taken[0] : undefined;
  if (occ?.has_student) {
    return NextResponse.json(
      { error: "This phone number is registered to another account." },
      { status: 409 }
    );
  }
  if (occ && !occ.has_student) {
    await db.execute(sql`DELETE FROM parents WHERE id = ${occ.id}`);
  }

  const code = generateOtp();
  const hash = await bcrypt.hash(code, 8);
  await redis.set(`chg-phone:otp:${me.id}:${body.newPhone}`, hash, "EX", OTP_TTL);
  await redis.del(`chg-phone:attempts:${me.id}:${body.newPhone}`);

  await sendSms({
    phone: body.newPhone,
    body: `Inventre — code ${code} to confirm this new phone number. Valid 5 minutes.`,
    variables: { otp: code, mobile: body.newPhone },
  });

  return NextResponse.json({ ok: true, ttl: OTP_TTL });
}
