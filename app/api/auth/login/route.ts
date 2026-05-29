import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { createParentSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { resolveFamilyParent } from "@/lib/parent-lookup";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/, "10-digit mobile number required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  const rl = await rateLimit({
    key: `login:${ip}`,
    max: 20,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid request", details: e },
      { status: 400 }
    );
  }

  // Resolve the family's parents row from the multi-guardian graph
  // (any guardian's phone routes to the same family). This intentionally
  // ignores zombie rows that own 0 students so a stray exact-phone match
  // doesn't shadow the real family parent.
  const parent = await resolveFamilyParent(body.phone);

  if (!parent || !parent.passwordHash) {
    return NextResponse.json(
      { error: "Invalid mobile number or password" },
      { status: 401 }
    );
  }

  // First-time accounts must verify OTP + set their own password first.
  if (parent.firstTimeLogin) {
    return NextResponse.json(
      {
        error:
          "First-time sign-in: verify OTP and set your password to continue.",
        firstTime: true,
      },
      { status: 409 }
    );
  }

  const ok = await bcrypt.compare(body.password, parent.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "Invalid mobile number or password" },
      { status: 401 }
    );
  }
  if (parent.status !== "active") {
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );
  }

  await createParentSession(parent.id, body.phone);
  return NextResponse.json({ ok: true });
}
