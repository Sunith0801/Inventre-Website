import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { redis } from "@/server/redis";
import { isEmailConfigured, sendEmail } from "@/server/notify/email";

/**
 * Staff "forgot password" — step 1 of 2.
 *
 *   POST { email }  →  { ok: true }   (always, whether or not the email exists)
 *
 * For an ACTIVE staff account a single-use reset link is emailed; the token
 * lives in Redis for 30 minutes and is consumed by /reset-password. The
 * response never reveals whether an address is registered, and the endpoint
 * is rate-limited per address and per IP so it cannot be used to spam a
 * mailbox or probe the staff list.
 *
 * Mirrors the parent flow at /api/auth/forgot-password, which sends the link
 * by SMS to a mobile; staff sign in with email, so the link goes there.
 */
export const RESET_TTL_SECONDS = 30 * 60;
export const resetKey = (token: string) =>
  `adminpwreset:${crypto.createHash("sha256").update(token).digest("hex")}`;

const Body = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipLimit = await rateLimit({ key: `adminpwreset:ip:${ip}`, max: 10, windowSeconds: 60 * 60 });
  if (!ipLimit.ok) {
    return NextResponse.json({ error: "Too many reset requests. Try again later." }, { status: 429 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();

  const emailLimit = await rateLimit({ key: `adminpwreset:email:${email}`, max: 3, windowSeconds: 60 * 60 });
  if (!emailLimit.ok) {
    return NextResponse.json({ error: "Too many reset requests. Try again later." }, { status: 429 });
  }

  const [user] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.email, email), eq(users.status, "active")))
    .limit(1);

  if (user) {
    const token = crypto.randomBytes(32).toString("base64url");
    await redis.set(resetKey(token), user.id, "EX", RESET_TTL_SECONDS);

    // Behind nginx the request host is the internal bind, so build the link
    // from the forwarded headers — the same way the portal magic link did.
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "inventre.in";
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || `${proto}://${host}`;
    const url = `${base}/admin/reset-password?t=${token}`;

    const first = user.name?.trim().split(/\s+/)[0] || "there";
    const result = await sendEmail({
      to: email,
      subject: "Reset your Inventre admin password",
      text: `Hi ${first},\n\nSomeone asked to reset the password for your Inventre admin account. Open this link to choose a new one (valid for 30 minutes):\n\n${url}\n\nIf you did not ask for this, ignore this email — your password stays as it is.`,
      html: `<p>Hi ${first},</p><p>Someone asked to reset the password for your Inventre admin account. Click below to choose a new one — the link is valid for 30 minutes.</p><p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:999px;text-decoration:none;font-weight:600">Reset password</a></p><p style="color:#666;font-size:12px">Or copy this link: ${url}</p><p style="color:#666;font-size:12px">If you did not ask for this, ignore this email — your password stays as it is.</p>`,
    });

    // No transport (a dev/staging box): the link is printed to the server
    // log so the flow can still be exercised. Never in production.
    if (!result.ok && !isEmailConfigured() && process.env.NODE_ENV !== "production") {
      console.log(`[admin-reset] no email transport — reset link for ${email}: ${url}`);
    } else if (!result.ok) {
      console.error(`[admin-reset] email to ${email} failed:`, result.error);
    }
  }

  return NextResponse.json({ ok: true });
}
