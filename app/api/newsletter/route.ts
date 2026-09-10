import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";

/**
 * Newsletter signup endpoint. Currently logs the email (dev) — wire to your
 * email-marketing provider (Resend audiences, Mailchimp, ConvertKit) by
 * replacing the console.log with the provider's API call.
 */

const Body = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `newsletter:${ip}`,
    max: 10,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok)
    return NextResponse.json({ error: "Try again later" }, { status: 429 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Please enter a valid email" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line no-console
  console.log(`📨 Newsletter signup: ${body.email}`);
  return NextResponse.json({ ok: true });
}
