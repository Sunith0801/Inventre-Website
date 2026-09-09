import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { permissionsFor } from "@/lib/fees-auth";
import { isFeesScopedPermission } from "@/lib/fees-users";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createAdminSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `admin:login:${ip}`,
    max: 5,
    windowSeconds: 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many attempts" },
      { status: 429 }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
  if (!user || user.status !== "active")
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok)
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );

  // Fee-ledger accounts have their own session and their own door. Issuing
  // them an admin cookie here would put them back inside /admin, where ~60
  // pages carry no permission guard of their own.
  const perms = await permissionsFor(user.id);
  let staff = false;
  for (const p of perms) {
    if (!isFeesScopedPermission(p)) {
      staff = true;
      break;
    }
  }
  if (!staff && perms.size > 0) {
    return NextResponse.json(
      { error: "This is a fee-ledger account — sign in at /fees/login" },
      { status: 403 }
    );
  }

  await createAdminSession(user.id, user.role, user.schoolId);
  return NextResponse.json({ ok: true });
}
