import { NextRequest, NextResponse } from "next/server";
import bcrypt from "@node-rs/bcrypt";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { createFeesSession, permissionsFor } from "@/lib/fees-auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Fee-ledger sign-in. Issues the `inv_fees` cookie only — never an admin
 * session — so a fee-desk login cannot reach /admin even if a page there
 * forgets its own permission check.
 */
function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit({ key: `fees-login:${ip}`, max: 10, windowSeconds: 60 });
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const [user] = rowsOf<{ id: string; password_hash: string; status: string }>(
    await db.execute(sql`
      SELECT id, password_hash, status FROM users WHERE email = ${email} LIMIT 1
    `)
  );
  // One message for every failure mode — a distinct "no such account" would
  // turn this into an account-enumeration oracle.
  const invalid = NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  if (!user || user.status !== "active") return invalid;
  if (!(await bcrypt.compare(password, user.password_hash))) return invalid;

  const perms = await permissionsFor(user.id);
  if (!perms.has("fees.read") && !perms.has("fees.write") && !perms.has("fees-users.write")) {
    return NextResponse.json(
      { error: "This account does not have fee-ledger access" },
      { status: 403 }
    );
  }

  await createFeesSession(user.id);
  return NextResponse.json({ ok: true });
}
