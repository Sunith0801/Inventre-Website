/**
 * "Try another way" step 2: verify the email OTP. On success we set a
 * 15-minute marker proving email ownership; the new-number request +
 * confirm steps will accept it in lieu of the old-phone marker.
 *
 *   POST { studentId, otp }  →  { ok: true }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";

const Body = z.object({
  studentId: z.string().uuid(),
  otp: z.string().regex(/^\d{6}$/),
});
const MAX_ATTEMPTS = 5;
const MARKER_TTL = 15 * 60;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-verify-email:${ip}`,
    max: 15,
    windowSeconds: 10 * 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const attempts = await redis.incr(`otp:email:attempts:${body.studentId}`);
  if (attempts === 1)
    await redis.expire(`otp:email:attempts:${body.studentId}`, 600);
  if (attempts > MAX_ATTEMPTS)
    return NextResponse.json(
      { error: "Too many attempts. Request a new OTP." },
      { status: 429 }
    );

  const raw = await redis.get(`otp:email:${body.studentId}`);
  if (!raw)
    return NextResponse.json(
      { error: "OTP expired. Request a new one." },
      { status: 400 }
    );
  let payload: { hash: string; parentId: string; email: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "OTP expired. Request a new one." },
      { status: 400 }
    );
  }
  if (!(await bcrypt.compare(body.otp, payload.hash)))
    return NextResponse.json(
      { error: "Incorrect OTP. Try again." },
      { status: 401 }
    );

  await redis.del(`otp:email:${body.studentId}`);
  await redis.del(`otp:email:attempts:${body.studentId}`);
  // Marker the new-number step will accept. The value carries the parentId
  // we resolved at request-otp time, or "pending" when the student has no
  // parent yet — in which case confirm will lazy-create the parent from the
  // first guardian-link row and the newly entered phone.
  await redis.set(
    `recover:email-ok:${body.studentId}`,
    payload.parentId ?? "pending",
    "EX",
    MARKER_TTL
  );

  return NextResponse.json({ ok: true });
}
