import { NextRequest, NextResponse } from "next/server";
import bcrypt from "@node-rs/bcrypt";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { getFeesViewer, viewerHas } from "@/lib/fees-auth";
import {
  MANAGED_ROLES,
  FEES_VIEWER_ROLE,
  passwordProblem,
  emailProblem,
} from "@/lib/fees-users";

/**
 * Account management for the fee ledger, gated on `fees-users.write`.
 *
 * Scoped on purpose: a fee-ledger admin is NOT given `settings-users.write`,
 * which would let them edit super admins — reset the super's password, or
 * grant themselves catalog.write. Here every query is fenced to
 * `MANAGED_ROLES`, so accounts outside the fee ledger are invisible and
 * untouchable, and the only assignable roles are ones whose permissions are
 * fees-scoped. A fee admin therefore cannot mint an account with more reach
 * than their own, which is the whole point.
 *
 * See lib/fees-users.ts for the invariants this file enforces.
 */

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

/**
 * Managed roles as a bound IN-list. `${MANAGED_ROLES}::text[]` looks right
 * but Drizzle binds a JS array as a single opaque parameter, and Postgres
 * refuses the cast (42846) — so the list is expanded into one placeholder
 * per role instead.
 */
const managedRoles = sql.join(
  MANAGED_ROLES.map((r) => sql`${r}`),
  sql`, `
);

async function listUsers() {
  const res = await db.execute(sql`
    SELECT u.id, u.email, u.name, u.status, u.last_login_at, u.created_at,
           r.slug AS role_slug, r.name AS role_name
    FROM users u
    JOIN admin_roles r ON r.id = u.role_id
    WHERE r.slug IN (${managedRoles})
    ORDER BY u.email
  `);
  return rowsOf<Record<string, unknown>>(res).map((r) => ({
    id: String(r.id),
    email: String(r.email),
    name: (r.name as string | null) ?? null,
    status: String(r.status),
    roleSlug: String(r.role_slug),
    roleName: String(r.role_name),
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
    createdAt: r.created_at ? String(r.created_at) : null,
  }));
}

async function assignableRoles() {
  const res = await db.execute(sql`
    SELECT r.slug, r.name, r.description,
           (SELECT count(*)::int FROM admin_role_permissions p WHERE p.role_id = r.id) AS perms
    FROM admin_roles r
    WHERE r.slug IN (${managedRoles})
    ORDER BY r.name
  `);
  return rowsOf<Record<string, unknown>>(res).map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
  }));
}

export async function GET() {
  const me = await getFeesViewer();
  if (!viewerHas(me, "fees-users.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [users, roles] = await Promise.all([listUsers(), assignableRoles()]);
  return NextResponse.json({ users, roles });
}

export async function POST(req: NextRequest) {
  const me = await getFeesViewer();
  if (!viewerHas(me, "fees-users.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, 120) || null;
  const password = String(body.password ?? "");
  const roleSlug = String(body.roleSlug ?? FEES_VIEWER_ROLE);

  const emailErr = emailProblem(email);
  if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 });
  const pwErr = passwordProblem(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
  if (!MANAGED_ROLES.includes(roleSlug)) {
    return NextResponse.json({ error: "That role cannot be assigned here" }, { status: 400 });
  }

  const [role] = rowsOf<{ id: string }>(
    await db.execute(sql`SELECT id FROM admin_roles WHERE slug = ${roleSlug} LIMIT 1`)
  );
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 400 });
  }

  // An existing address may belong to a staff admin; refusing on any
  // collision keeps this endpoint from being a way to discover — or worse,
  // overwrite — accounts outside the fee ledger.
  const [clash] = rowsOf<{ id: string }>(
    await db.execute(sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`)
  );
  if (clash) {
    return NextResponse.json({ error: "That email already has an account" }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 12);
  const [created] = rowsOf<{ id: string }>(
    await db.execute(sql`
      INSERT INTO users (email, password_hash, role, role_id, name, status)
      VALUES (${email}, ${hash}, 'school_admin', ${role.id}, ${name}, 'active')
      RETURNING id
    `)
  );
  return NextResponse.json({ ok: true, id: created.id, users: await listUsers() });
}

export async function PATCH(req: NextRequest) {
  const me = await getFeesViewer();
  if (!me || !viewerHas(me, "fees-users.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const action = String(body.action ?? "");
  // A malformed id would otherwise reach `${id}::uuid` and surface as a 500.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // The fence: resolve the target ONLY within the managed roles. A staff
  // account's id simply does not resolve here.
  const [target] = rowsOf<{ id: string; email: string }>(
    await db.execute(sql`
      SELECT u.id, u.email
      FROM users u
      JOIN admin_roles r ON r.id = u.role_id
      WHERE u.id = ${id}::uuid AND r.slug IN (${managedRoles})
      LIMIT 1
    `)
  );
  if (!target) {
    return NextResponse.json({ error: "No such fee-ledger account" }, { status: 404 });
  }

  if (action === "reset-password") {
    const password = String(body.password ?? "");
    const pwErr = passwordProblem(password);
    if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
    const hash = await bcrypt.hash(password, 12);
    await db.execute(sql`UPDATE users SET password_hash = ${hash} WHERE id = ${target.id}::uuid`);
    return NextResponse.json({ ok: true, users: await listUsers() });
  }

  if (action === "set-status") {
    // `account_status` is (active | blocked | pending) — there is no
    // "disabled" member, and casting one silently 500s.
    const status = String(body.status ?? "");
    if (status !== "active" && status !== "blocked") {
      return NextResponse.json({ error: "status must be active or blocked" }, { status: 400 });
    }
    // Locking yourself out of the page that unlocks accounts is a support
    // call, so it is refused rather than confirmed.
    if (target.id === me.id && status === "blocked") {
      return NextResponse.json({ error: "You cannot disable your own account" }, { status: 400 });
    }
    await db.execute(
      sql`UPDATE users SET status = ${status}::account_status WHERE id = ${target.id}::uuid`
    );
    return NextResponse.json({ ok: true, users: await listUsers() });
  }

  if (action === "set-role") {
    const roleSlug = String(body.roleSlug ?? "");
    if (!MANAGED_ROLES.includes(roleSlug)) {
      return NextResponse.json({ error: "That role cannot be assigned here" }, { status: 400 });
    }
    if (target.id === me.id) {
      return NextResponse.json(
        { error: "You cannot change your own role here" },
        { status: 400 }
      );
    }
    const [role] = rowsOf<{ id: string }>(
      await db.execute(sql`SELECT id FROM admin_roles WHERE slug = ${roleSlug} LIMIT 1`)
    );
    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 400 });
    await db.execute(
      sql`UPDATE users SET role_id = ${role.id} WHERE id = ${target.id}::uuid`
    );
    return NextResponse.json({ ok: true, users: await listUsers() });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
