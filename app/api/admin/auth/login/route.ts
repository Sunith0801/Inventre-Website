import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { permissionsFor } from "@/server/fees-auth";
import { isFeesScopedPermission } from "@/server/fees-users";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createAdminSession } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";

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

  // Record the login. `users.last_login_at` existed but nothing ever wrote it
  // for staff — only the parent OTP path did — so all 14 admin accounts read
  // "never" and there was no way to tell a live account from a dormant one, or
  // to size a permission change against who actually uses what.
  //
  // Deliberately not awaited and deliberately caught: a failure to record a
  // timestamp must never turn a successful sign-in into an error.
  void db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id))
    .catch((e) => console.error("[admin-login] lastLoginAt update failed:", e));

  return NextResponse.json({ ok: true });
}
