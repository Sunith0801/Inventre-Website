import "server-only";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { signSession, verifySession, FEES_SESSION_COOKIE } from "@/lib/jwt";
import { getCurrentUser } from "@/server/session";
import { isFeesScopedPermission } from "@/server/fees-users";

/**
 * The fee ledger's own session.
 *
 * Why a separate cookie rather than an admin session with few permissions:
 * a fee-desk login was previously `kind: "admin"`, so it WAS an admin —
 * just one that most pages happened to refuse. Since ~60 admin pages carry
 * no permission guard of their own, that made every one of them one bug
 * away from a fee-desk account. With its own cookie and `kind: "fees"`, the
 * admin guards reject the token outright: not an under-privileged admin,
 * simply not an admin.
 *
 * It also means one browser can hold both logins at once, which the shared
 * cookie made impossible.
 *
 * Staff keep a single login: `requireFeesAccess` also accepts a normal
 * admin session, provided that account holds real admin permissions. A
 * fees-only account with a leftover admin cookie is NOT accepted — it must
 * sign in at /fees/login, so the boundary cannot be walked around.
 */

const SESSION_MAX_AGE = 60 * 60 * 12;

export type FeesUser = {
  kind: "fees" | "admin";
  id: string;
  email: string;
  name: string | null;
  permissions: ReadonlySet<string>;
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export async function createFeesSession(userId: string) {
  const token = await signSession({ sub: userId, kind: "fees" });
  const jar = await cookies();
  jar.set(FEES_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_INSECURE !== "1",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroyFeesSession() {
  const jar = await cookies();
  jar.set(FEES_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** Effective permissions for a user id: role grants ∪ user grants \ revokes. */
export async function permissionsFor(userId: string): Promise<Set<string>> {
  const perms = new Set<string>();
  const roleRows = rowsOf<{ permission: string | null }>(
    await db.execute(sql`
      SELECT p.permission
      FROM users u
      LEFT JOIN admin_role_permissions p ON p.role_id = u.role_id
      WHERE u.id = ${userId}::uuid
    `)
  );
  for (const r of roleRows) if (r.permission) perms.add(r.permission);
  const overrides = rowsOf<{ permission: string; granted: boolean }>(
    await db.execute(sql`
      SELECT permission, granted FROM admin_user_permissions WHERE user_id = ${userId}::uuid
    `)
  );
  for (const o of overrides) {
    if (o.granted) perms.add(o.permission);
    else perms.delete(o.permission);
  }
  return perms;
}

/** The fee-ledger session, if one is present and still valid. */
export async function getFeesSessionUser(): Promise<FeesUser | null> {
  const jar = await cookies();
  const tok = jar.get(FEES_SESSION_COOKIE)?.value;
  if (!tok) return null;
  // Use the shared verifier: signing uses JWT_SECRET specifically, and a
  // local key() that preferred AUTH_SECRET silently failed every verify.
  const payload = await verifySession(tok);
  if (!payload || payload.kind !== "fees") return null;
  const sub = String(payload.sub ?? "");
  if (!sub) return null;

  const [user] = rowsOf<{ id: string; email: string; name: string | null; status: string }>(
    await db.execute(sql`
      SELECT id, email, name, status FROM users WHERE id = ${sub}::uuid LIMIT 1
    `)
  );
  // A blocked account must lose access immediately, not at token expiry.
  if (!user || user.status !== "active") return null;

  return {
    kind: "fees",
    id: user.id,
    email: user.email,
    name: user.name,
    permissions: await permissionsFor(user.id),
  };
}

/**
 * Whoever is allowed to see the fee ledger right now: a fees session, or a
 * staff admin session. Returns null when neither applies.
 */
export async function getFeesViewer(): Promise<FeesUser | null> {
  const fees = await getFeesSessionUser();
  if (fees) return fees;

  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return null;
  // Staff only. A fees-only account holding an admin cookie (issued before
  // the split, or by any future slip) is refused here so the two areas
  // cannot be bridged by the wrong cookie.
  let isStaff = false;
  for (const p of me.permissions) {
    if (!isFeesScopedPermission(p)) {
      isStaff = true;
      break;
    }
  }
  if (!isStaff) return null;
  return {
    kind: "admin",
    id: me.id,
    email: me.email,
    name: me.name ?? null,
    permissions: me.permissions,
  };
}

/** True when this viewer holds at least one of the listed permissions. */
export function viewerHas(viewer: FeesUser | null, ...permissions: string[]) {
  if (!viewer) return false;
  return permissions.some((p) => viewer.permissions.has(p));
}
