/**
 * Query layer for the Administration → Users screen.
 *
 * Everything the screen needs to ASK the database lives here; everything it
 * needs to SHOW lives in `components/admin/users/`; the vocabulary and URL
 * encoding both sides share live in `lib/admin-users-view.ts`. The page
 * component in between does none of the three — it parses the URL, calls
 * this module, and renders.
 *
 * ── This module is server-only ──────────────────────────────────────────
 * It imports `db`, so importing it from a `"use client"` file pulls
 * `postgres` and node's `net`/`tls` into the browser bundle and fails the
 * build. Client components import from `lib/admin-users-view` instead. That
 * is not a style preference; it is the reason the split exists.
 *
 * ── On scale ────────────────────────────────────────────────────────────
 * The old screen did `SELECT * FROM users ORDER BY email` with no LIMIT and
 * rendered every row. That is fine at ten accounts and falls over at ten
 * thousand. Every query here is windowed, the filters are pushed into SQL
 * rather than applied in JavaScript, and the facet counts are one grouped
 * scan rather than one query per badge.
 *
 * ── On the RBAC tables ──────────────────────────────────────────────────
 * `admin_roles` / `admin_role_permissions` were created by raw SQL
 * (db/migrations/0044_admin_rbac.sql) and deliberately never added to the
 * Drizzle schema, so the rest of the codebase reaches them through
 * `db.execute(sql…)`. This module follows that existing convention rather
 * than introducing a second way to read the same tables.
 *
 * Every value that reaches SQL is either a bound parameter or a key looked up
 * in a frozen whitelist — `sql.raw` is never handed user input.
 */

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  USER_STATUS_LABEL,
  type AdminUserRow,
  type LastLoginWindow,
  type SortKey,
  type UserFilters,
  type UserStatus,
} from "@/lib/admin-users-view";

export type { AdminUserRow } from "@/lib/admin-users-view";

// ════════════════════════════════════════════════════════════════════
// SQL fragments keyed by the shared vocabulary
// ════════════════════════════════════════════════════════════════════

/** Implements each window declared by `LAST_LOGIN_LABELS`. */
const LAST_LOGIN_CLAUSE: Record<LastLoginWindow, SQL> = {
  never: sql`u.last_login_at IS NULL`,
  "24h": sql`u.last_login_at >= now() - interval '24 hours'`,
  "7d": sql`u.last_login_at >= now() - interval '7 days'`,
  "30d": sql`u.last_login_at >= now() - interval '30 days'`,
  stale: sql`u.last_login_at IS NOT NULL AND u.last_login_at < now() - interval '90 days'`,
};

/**
 * Sort token → SQL expression. This map is the ONLY thing that reaches
 * `sql.raw`, and it can only ever be indexed by a `SortKey`, which
 * `parseUserFilters` has already validated against a frozen list.
 */
const SORT_EXPR: Record<SortKey, string> = {
  user: "lower(coalesce(u.name, u.email))",
  role: "lower(coalesce(r.name, u.role::text))",
  school: "lower(coalesce(s.name, ''))",
  status: "u.status::text",
  lastLogin: "u.last_login_at",
  created: "u.created_at",
};

/** The joins every query over this screen shares. */
const FROM_USERS = sql`
    FROM users u
    LEFT JOIN admin_roles r ON r.id = u.role_id
    LEFT JOIN schools     s ON s.id = u.school_id
`;

/**
 * postgres.js returns rows as an array; some drivers wrap them in `{ rows }`.
 * The codebase has been bitten by the difference before (see
 * tests/regression/postgres-row-count.test.ts), so every read goes through
 * this rather than assuming a shape.
 */
function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

/**
 * Builds the predicate list. Returned as an array rather than a single `SQL`
 * so callers can compose a variant that omits one clause — the facet counts
 * need "every filter EXCEPT status", so clicking a status tile narrows the
 * table without zeroing the tile it was counted from.
 */
function predicates(f: UserFilters, opts: { includeStatus: boolean }): SQL[] {
  const out: SQL[] = [sql`TRUE`];

  if (f.q) {
    // The two fields an administrator searches by. A leading wildcard cannot
    // use a btree index; at this table's size that is irrelevant, and a
    // trigram index is the answer if it stops being so.
    const like = `%${f.q}%`;
    out.push(sql`(u.name ILIKE ${like} OR u.email ILIKE ${like})`);
  }
  if (f.roleId) out.push(sql`u.role_id = ${f.roleId}::uuid`);
  if (f.schoolId) out.push(sql`u.school_id = ${f.schoolId}::uuid`);
  if (f.lastLogin) out.push(LAST_LOGIN_CLAUSE[f.lastLogin]);
  if (opts.includeStatus && f.status) out.push(sql`u.status = ${f.status}::account_status`);

  return out;
}

const conjoin = (parts: SQL[]): SQL => parts.reduce((a, b) => sql`${a} AND ${b}`);

// ════════════════════════════════════════════════════════════════════
// Listing
// ════════════════════════════════════════════════════════════════════

export type AdminUserPage = {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  /** 1-based index of the first and last row shown, for "51–100 of 1,204". */
  from: number;
  to: number;
};

export async function listAdminUsers(f: UserFilters): Promise<AdminUserPage> {
  const where = conjoin(predicates(f, { includeStatus: true }));

  const total = Number(
    rowsOf<{ n: number }>(
      await db.execute(sql`SELECT count(*)::int AS n ${FROM_USERS} WHERE ${where}`)
    )[0]?.n ?? 0
  );

  const pages = Math.max(1, Math.ceil(total / f.perPage));
  // Clamp rather than trust: a deep `?page=900` on a freshly filtered list
  // would otherwise render an empty table with no way to tell why.
  const page = Math.min(f.page, pages);
  const offset = (page - 1) * f.perPage;

  // Nulls sort last in BOTH directions, so "never logged in" collects at the
  // end rather than occupying the whole first page of a descending sort.
  const orderBy = sql.raw(
    `${SORT_EXPR[f.sort]} ${f.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`
  );

  const rows = rowsOf<{
    id: string;
    email: string;
    name: string | null;
    status: UserStatus;
    last_login_at: string | null;
    created_at: string;
    role_id: string | null;
    role_name: string | null;
    role_slug: string | null;
    is_system_role: boolean | null;
    legacy_role: string;
    school_id: string | null;
    school_name: string | null;
    grant_count: number;
    revoke_count: number;
  }>(
    await db.execute(sql`
      SELECT u.id, u.email, u.name, u.status,
             u.last_login_at, u.created_at,
             u.role_id, r.name AS role_name, r.slug AS role_slug,
             r.is_system AS is_system_role,
             u.role::text AS legacy_role,
             u.school_id, s.name AS school_name,
             (SELECT count(*) FROM admin_user_permissions p WHERE p.user_id = u.id AND p.granted)::int     AS grant_count,
             (SELECT count(*) FROM admin_user_permissions p WHERE p.user_id = u.id AND NOT p.granted)::int AS revoke_count
        ${FROM_USERS}
       WHERE ${where}
       ORDER BY ${orderBy}, u.email ASC
       LIMIT ${f.perPage} OFFSET ${offset}
    `)
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      status: r.status,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      roleId: r.role_id,
      roleName: r.role_name,
      roleSlug: r.role_slug,
      isSystemRole: Boolean(r.is_system_role),
      legacyRole: r.legacy_role,
      schoolId: r.school_id,
      schoolName: r.school_name,
      grantCount: r.grant_count,
      revokeCount: r.revoke_count,
    })),
    total,
    page,
    pages,
    perPage: f.perPage,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + f.perPage, total),
  };
}

// ════════════════════════════════════════════════════════════════════
// Facets & options
// ════════════════════════════════════════════════════════════════════

export type StatusFacets = Record<UserStatus, number> & { total: number };

/**
 * Counts per status, honouring every filter EXCEPT status itself. One grouped
 * scan, not four counts.
 */
export async function adminUserStatusFacets(f: UserFilters): Promise<StatusFacets> {
  const where = conjoin(predicates(f, { includeStatus: false }));
  const rows = rowsOf<{ status: UserStatus; n: number }>(
    await db.execute(
      sql`SELECT u.status::text AS status, count(*)::int AS n ${FROM_USERS} WHERE ${where} GROUP BY 1`
    )
  );
  const at = (s: UserStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return {
    active: at("active"),
    blocked: at("blocked"),
    pending: at("pending"),
    total: rows.reduce((sum, r) => sum + r.n, 0),
  };
}

export type FilterOption = { id: string; label: string; count: number };

/**
 * Roles for the Role filter, each carrying how many accounts hold it — the
 * count is what turns a dropdown into a piece of information ("Agent: 0"
 * tells you the role is unused before you filter by it).
 */
export async function listRoleOptions(): Promise<FilterOption[]> {
  return rowsOf<FilterOption>(
    await db.execute(sql`
      SELECT r.id, r.name AS label,
             (SELECT count(*) FROM users u WHERE u.role_id = r.id)::int AS count
        FROM admin_roles r
       ORDER BY r.is_system DESC, lower(r.name)
    `)
  );
}

/**
 * Schools that actually have an account scoped to them. Listing all ~40
 * schools when three are in use makes the filter harder to use, not richer.
 */
export async function listScopeOptions(): Promise<FilterOption[]> {
  return rowsOf<FilterOption>(
    await db.execute(sql`
      SELECT s.id, s.name AS label, count(u.id)::int AS count
        FROM schools s
        JOIN users u ON u.school_id = s.id
       GROUP BY s.id, s.name
       ORDER BY lower(s.name)
    `)
  );
}

/**
 * Every school, for the create form's scope picker.
 *
 * Deliberately NOT `listScopeOptions` — that lists only schools that already
 * have an account, which is the right list to FILTER by and the wrong list to
 * CREATE from: the school you are onboarding has no user yet, which is
 * precisely why you are adding one.
 */
export async function listAllSchools(): Promise<{ id: string; name: string }[]> {
  return rowsOf<{ id: string; name: string }>(
    await db.execute(sql`SELECT id, name FROM schools ORDER BY lower(name)`)
  );
}

/**
 * How many active Super Admins exist.
 *
 * The API refuses any change that would take this to zero. The screen reads
 * the same number so it can disable the action rather than let an operator
 * click into a 400 — the check stays authoritative on the server; this only
 * drives the affordance.
 */
export async function countActiveSuperAdmins(): Promise<number> {
  const rows = rowsOf<{ n: number }>(
    await db.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE role = 'super' AND status = 'active'`
    )
  );
  return Number(rows[0]?.n ?? 0);
}

/** Re-exported so CSV rendering and the table agree on every status label. */
export { USER_STATUS_LABEL };

// ════════════════════════════════════════════════════════════════════
// Per-user access overrides
// ════════════════════════════════════════════════════════════════════

export type UserAccess = {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  roleId: string | null;
  roleName: string;
  /** The role's grants — what this user inherits before any exception. */
  baseline: string[];
  /** This user's explicit exceptions on top of the role. */
  overrides: { permission: string; granted: boolean }[];
};

/**
 * Everything the per-user access screen needs, in three queries.
 *
 * Baseline and overrides are returned separately rather than pre-merged: the
 * screen's whole job is showing where they DIFFER, and a merged set has
 * already thrown that away.
 */
export async function getUserAccess(id: string): Promise<UserAccess | null> {
  const [row] = rowsOf<{
    id: string;
    email: string;
    name: string | null;
    status: UserStatus;
    role_id: string | null;
    role_name: string | null;
    legacy_role: string;
  }>(
    await db.execute(sql`
      SELECT u.id, u.email, u.name, u.status, u.role_id,
             r.name AS role_name, u.role::text AS legacy_role
        FROM users u
        LEFT JOIN admin_roles r ON r.id = u.role_id
       WHERE u.id = ${id}::uuid
       LIMIT 1
    `)
  );
  if (!row) return null;

  const baseline = row.role_id
    ? rowsOf<{ permission: string }>(
        await db.execute(
          sql`SELECT permission FROM admin_role_permissions WHERE role_id = ${row.role_id}::uuid`
        )
      ).map((p) => p.permission)
    : [];

  const overrides = rowsOf<{ permission: string; granted: boolean }>(
    await db.execute(
      sql`SELECT permission, granted FROM admin_user_permissions WHERE user_id = ${id}::uuid`
    )
  );

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    roleId: row.role_id,
    // An account predating the RBAC rollout has no role row; the legacy enum
    // is the honest thing to show rather than an empty cell.
    roleName: row.role_name ?? `${row.legacy_role} (legacy)`,
    baseline,
    overrides,
  };
}

/** One user, in the same shape the list uses — for the detail page header. */
export async function getAdminUser(id: string): Promise<AdminUserRow | null> {
  const [r] = rowsOf<{
    id: string; email: string; name: string | null; status: UserStatus;
    last_login_at: string | null; created_at: string;
    role_id: string | null; role_name: string | null; role_slug: string | null;
    is_system_role: boolean | null; legacy_role: string;
    school_id: string | null; school_name: string | null;
    grant_count: number; revoke_count: number;
  }>(
    await db.execute(sql`
      SELECT u.id, u.email, u.name, u.status, u.last_login_at, u.created_at,
             u.role_id, r.name AS role_name, r.slug AS role_slug, r.is_system AS is_system_role,
             u.role::text AS legacy_role, u.school_id, s.name AS school_name,
             (SELECT count(*) FROM admin_user_permissions p WHERE p.user_id = u.id AND p.granted)::int     AS grant_count,
             (SELECT count(*) FROM admin_user_permissions p WHERE p.user_id = u.id AND NOT p.granted)::int AS revoke_count
        ${FROM_USERS}
       WHERE u.id = ${id}::uuid
       LIMIT 1
    `)
  );
  if (!r) return null;
  return {
    id: r.id, email: r.email, name: r.name, status: r.status,
    lastLoginAt: r.last_login_at, createdAt: r.created_at,
    roleId: r.role_id, roleName: r.role_name, roleSlug: r.role_slug,
    isSystemRole: Boolean(r.is_system_role), legacyRole: r.legacy_role,
    schoolId: r.school_id, schoolName: r.school_name,
    grantCount: r.grant_count, revokeCount: r.revoke_count,
  };
}
