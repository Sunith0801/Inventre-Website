import "server-only";
import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { getCurrentUser, type CurrentAdmin } from "./session";

export async function requireAdmin(
  ...allowedRoles: ("super" | "ops" | "school_admin")[]
): Promise<CurrentAdmin | NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (allowedRoles.length && !allowedRoles.includes(me.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return me;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * Require the current admin to hold a specific permission (e.g.
 * "orders.write"). Effective set = role perms unioned with per-user
 * grants, minus per-user revokes. See `lib/session.ts:getCurrentUser`.
 */
export async function requirePermission(
  permission: string,
): Promise<CurrentAdmin | NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!me.permissions.has(permission))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return me;
}

/**
 * Require the current admin to hold AT LEAST ONE of the listed permissions.
 * Useful for page-load gates that should pass for either read-only or
 * read+write users (e.g. `requireAnyPermission("orders.read", "orders.write")`).
 */
export async function requireAnyPermission(
  ...permissions: string[]
): Promise<CurrentAdmin | NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!permissions.some((p) => me.permissions.has(p)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return me;
}

/**
 * Require the current admin to hold ANY write permission (any "<slug>.write").
 * Use for cross-area utility endpoints — e.g. media upload — where the real
 * per-area authorization is enforced by the endpoint that consumes the result
 * (the catalog image route needs catalog.write, the content block route needs
 * content.write, …). A pure read-only admin is still rejected; anyone trusted
 * to mutate *something* may push bytes to storage.
 */
export async function requireAnyWritePermission(): Promise<
  CurrentAdmin | NextResponse
> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let hasWrite = false;
  for (const p of me.permissions) {
    if (p.endsWith(".write")) {
      hasWrite = true;
      break;
    }
  }
  if (!hasWrite)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return me;
}

/**
 * Boolean check for use inside server components and route handlers that
 * have already resolved `me`. Use `requirePermission` for the gate; use
 * `hasPermission` for branching (e.g. "render the Save button only if…").
 */
export function hasPermission(
  me: Pick<CurrentAdmin, "permissions"> | null | undefined,
  permission: string,
): boolean {
  return !!me && me.permissions.has(permission);
}

/**
 * For a school_admin, return the SQL fragment that scopes a query to their
 * school. For super/ops, returns null (= no scope). Apply at every admin
 * query that touches school-scoped data:
 *
 *   const scope = schoolScope(me, orders.schoolId);
 *   const where = scope ? and(otherFilter, scope) : otherFilter;
 */
export function schoolScope(
  me: CurrentAdmin,
  schoolIdColumn: { name: string } & Record<string, unknown>
): SQL | null {
  if (me.role !== "school_admin") return null;
  if (!me.schoolId) {
    // school_admin with no schoolId is a misconfiguration — fail closed.
    return sql`false`;
  }
  // Pass the column reference through drizzle's sql template.
  return sql`${schoolIdColumn} = ${me.schoolId}`;
}

/**
 * Helper for routes that take a :schoolId param. Verifies a school_admin can
 * only access their own school. Returns 403 NextResponse if not.
 */
export function assertSchoolAccess(
  me: CurrentAdmin,
  targetSchoolId: string | null | undefined
): NextResponse | null {
  if (me.role !== "school_admin") return null;
  if (!me.schoolId || me.schoolId !== targetSchoolId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

/**
 * One-call helper: require admin AND resolve the school filter that should be
 * applied to repo queries.
 *
 *   const r = await requireAdminWithSchoolScope("super", "ops", "school_admin");
 *   if (isResponse(r)) return r;
 *   const { admin, schoolId } = r;   // schoolId is null for super/ops
 *   const rows = await listFoo({ schoolId: schoolId ?? undefined });
 *
 * Fails closed if a school_admin has no schoolId — never silently downgrades
 * to "all schools".
 */
export async function requireAdminWithSchoolScope(
  ...allowedRoles: ("super" | "ops" | "school_admin")[]
): Promise<{ admin: CurrentAdmin; schoolId: string | null } | NextResponse> {
  const guard = await requireAdmin(...allowedRoles);
  if (isResponse(guard)) return guard;
  if (guard.role === "school_admin") {
    if (!guard.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return { admin: guard, schoolId: guard.schoolId };
  }
  return { admin: guard, schoolId: null };
}
