import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { sendSms } from "@/server/notify/sms";
import { redis } from "@/server/redis";

const RESET_TTL_SECONDS = 30 * 60;

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/),
});

export async function POST(req: Request) {
  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 }
    );
  }

  const rl = await rateLimit({
    key: `pwreset:${body.phone}`,
    max: 3,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many reset requests. Try again later." },
      { status: 429 }
    );
  }

  const [parent] = await db
    .select({ id: parents.id })
    .from(parents)
    .where(eq(parents.phone, body.phone))
    .limit(1);

  // Always succeed (don't leak whether the number is registered)
  if (parent) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await redis.set(
      `pwreset:${tokenHash}`,
      parent.id,
      "EX",
      RESET_TTL_SECONDS
    );

    const base = process.env.PUBLIC_BASE_URL ?? "https://inventre.in";
    const url = `${base}/reset?phone=${body.phone}&t=${token}`;
    await sendSms({
      phone: body.phone,
      body: `Reset your Inventre password: ${url}. Valid 30 minutes.`,
      variables: { mobile: body.phone, token },
    });
  }
  return NextResponse.json({ ok: true });
}
