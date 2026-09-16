/**
 * Query layer for Administration → Roles & permissions.
 *
 * Server-only: it imports `db`. The permission algebra the screens share
 * lives in `lib/admin-roles-view.ts`, on the client side of the boundary.
 *
 * ── On not paginating ───────────────────────────────────────────────────
 * Unlike Users, this list is deliberately unpaginated. Roles are authored by
 * hand and this install has eight; a system with a hundred is already
 * mismanaged. Search and sort are useful here, a page control is furniture.
 * The grants fetch below is the one query that would not scale, and it is
 * bounded by roles × 74 registry keys.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { hierarchyRank, looksLikeUuid, type RoleListRow } from "@/lib/admin-roles-view";

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

// ════════════════════════════════════════════════════════════════════
// Shapes
// ════════════════════════════════════════════════════════════════════

export type { RoleListRow } from "@/lib/admin-roles-view";

export type RoleDetail = RoleListRow & {
  createdAt: string;
  isSuperAdmin: boolean;
};

export type RoleUser = {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "blocked" | "pending";
  lastLoginAt: string | null;
  /** Exceptions this holder carries on top of the role — see AdminUserRow. */
  grantCount: number;
  revokeCount: number;
};

// ════════════════════════════════════════════════════════════════════
// Listing
// ════════════════════════════════════════════════════════════════════

/**
 * Grants for a set of roles, as one query rather than one per role.
 *
 * The N+1 version of this is the obvious way to write it and the reason a
 * roles list with a permission summary column ends up issuing a query per
 * row.
 */
async function grantsByRole(roleIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of roleIds) out.set(id, []);
  if (roleIds.length === 0) return out;

  const rows = rowsOf<{ role_id: string; permission: string }>(
    await db.execute(sql`
      SELECT role_id, permission
        FROM admin_role_permissions
       WHERE role_id IN (${sql.join(roleIds.map((id) => sql`${id}::uuid`), sql`, `)})
    `)
  );
  for (const r of rows) out.get(r.role_id)?.push(r.permission);
  return out;
}

export async function listRoles(): Promise<RoleListRow[]> {
  const rows = rowsOf<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_system: boolean;
    updated_at: string;
    user_count: number;
  }>(
    await db.execute(sql`
      SELECT r.id, r.slug, r.name, r.description, r.is_system, r.updated_at,
             (SELECT count(*) FROM users u WHERE u.role_id = r.id)::int AS user_count
        FROM admin_roles r
       ORDER BY lower(r.name)
    `)
  );
  // Hierarchy first (see ROLE_HIERARCHY), then the alphabetical order above
  // for anything outside it. Stable sort keeps that secondary order.
  rows.sort((a, b) => hierarchyRank(a.slug) - hierarchyRank(b.slug));

  const grants = await grantsByRole(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    updatedAt: r.updated_at,
    userCount: r.user_count,
    permissions: grants.get(r.id) ?? [],
  }));
}

// ════════════════════════════════════════════════════════════════════
// Detail
// ════════════════════════════════════════════════════════════════════

/**
 * Looks up by slug (`operations`) or, for links minted before slugs were the
 * address, by uuid. A hand-typed slug that matches nothing returns null and
 * the page 404s; it never throws.
 */
export async function getRole(slugOrId: string): Promise<RoleDetail | null> {
  const where = looksLikeUuid(slugOrId)
    ? sql`r.id = ${slugOrId}::uuid`
    : sql`r.slug = ${slugOrId}`;
  const [row] = rowsOf<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_system: boolean;
    created_at: string;
    updated_at: string;
    user_count: number;
  }>(
    await db.execute(sql`
      SELECT r.id, r.slug, r.name, r.description, r.is_system,
             r.created_at, r.updated_at,
             (SELECT count(*) FROM users u WHERE u.role_id = r.id)::int AS user_count
        FROM admin_roles r
       WHERE ${where}
       LIMIT 1
    `)
  );
  if (!row) return null;

  const permissions = rowsOf<{ permission: string }>(
    await db.execute(
      sql`SELECT permission FROM admin_role_permissions WHERE role_id = ${row.id}::uuid`
    )
  ).map((p) => p.permission);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userCount: row.user_count,
    permissions,
    isSuperAdmin: row.slug === "super-admin",
  };
}

/**
 * Accounts holding this role — the Roles → Users leg of the navigation.
 *
 * Capped: the list is a "who is affected by editing this" answer, not a user
 * browser. Past the cap the screen links to the Users screen filtered by this
 * role, which is the tool built for that job.
 */
export const ROLE_USERS_LIMIT = 50;

export async function listRoleUsers(roleId: string): Promise<RoleUser[]> {
  return rowsOf<{
    id: string;
    email: string;
    name: string | null;
    status: RoleUser["status"];
    last_login_at: string | null;
    grant_count: number;
    revoke_count: number;
  }>(
    await db.execute(sql`
      SELECT u.id, u.email, u.name, u.status, u.last_login_at,
             (SELECT count(*) FROM admin_user_permissions p WHERE p.user_id = u.id AND p.granted)::int     AS grant_count,
             (SELECT count(*) FROM admin_user_permissions p WHERE p.user_id = u.id AND NOT p.granted)::int AS revoke_count
        FROM users u
       WHERE u.role_id = ${roleId}::uuid
       ORDER BY lower(coalesce(u.name, u.email))
       LIMIT ${ROLE_USERS_LIMIT}
    `)
  ).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    lastLoginAt: u.last_login_at,
    grantCount: u.grant_count,
    revokeCount: u.revoke_count,
  }));
}
