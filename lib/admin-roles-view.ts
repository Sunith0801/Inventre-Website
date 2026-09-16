/**
 * Roles & permissions — the permission algebra, plus the vocabulary the
 * roles screens share.
 *
 * ── Why the logic is here and not in the component ──────────────────────
 * Every rule below is a policy decision about what a permission set MEANS:
 * that write implies read, that clearing read clears write, that a group
 * header cycles rather than toggles. Those lived inside a 308-line client
 * component, where they could not be exercised without rendering React and
 * could not be reused by the user-level override editor that needs exactly
 * the same rules.
 *
 * They are pure functions over a `Set<string>` now, which means
 * `tests/unit/role-permissions.test.ts` can state each rule as an assertion.
 *
 * No database import — the matrix is a client component, and this module is
 * on its side of the boundary (see lib/admin-users-view.ts for the same
 * split and why it exists).
 */

import {
  ADMIN_PAGES,
  ADMIN_PERMISSION_KEYS,
  readKey,
  writeKey,
  type AdminPage,
} from "@/lib/admin-permissions";

/** The slug of the role whose permission set is not editable. */
export const SUPER_ADMIN_SLUG = "super-admin";

/**
 * The staff hierarchy, top to bottom. The Roles page lists roles in this
 * order (not alphabetically) so the table reads like the org chart: who
 * runs the business first, then the floor and desk roles, then the
 * school-side and support roles. Roles not named here — legacy or custom
 * ones — follow, alphabetically.
 */
export const ROLE_HIERARCHY: readonly string[] = [
  "super-admin",
  "admin",
  "warehouse",
  "category",
  "operations",
  "sales",
  "school",
  "customer-care",
];

/**
 * Roles that act for ONE school. Only these carry a scope (`users.school_id`):
 * a school-side account is narrowed to its school, every other role sees all
 * schools and the scope control is not offered at all.
 */
export const SCHOOL_SCOPED_ROLE_SLUGS: ReadonlySet<string> = new Set([
  "school",
  "school-management",
]);

/**
 * The legacy three-value account type (`users.role`) every school-scoping
 * query still keys on, derived from the assigned role: Super Admin is
 * unrestricted, a school-side role is confined to its school, everything
 * else is staff across all schools.
 */
export function legacyRoleFor(slug: string | null | undefined): "super" | "ops" | "school_admin" {
  if (slug === SUPER_ADMIN_SLUG) return "super";
  if (isSchoolScopedRole(slug)) return "school_admin";
  return "ops";
}

export const isSchoolScopedRole = (slug: string | null | undefined): boolean =>
  !!slug && SCHOOL_SCOPED_ROLE_SLUGS.has(slug);

/** Position in the hierarchy; unlisted roles sort after every listed one. */
export function hierarchyRank(slug: string): number {
  const i = ROLE_HIERARCHY.indexOf(slug);
  return i === -1 ? ROLE_HIERARCHY.length : i;
}

/**
 * Role pages are addressed by SLUG — `/admin/roles/operations` — not by
 * uuid. A URL an administrator can read, say aloud and paste into a ticket
 * is part of the interface; `f28ed929-2970-…` is not. `admin_roles.slug` is
 * unique, so it is a safe key. The API routes keep using the uuid.
 */
export const roleHref = (slug: string, tab?: "users" | "activity"): string =>
  `/admin/roles/${encodeURIComponent(slug)}${tab ? `?tab=${tab}` : ""}`;

export const roleHolderHref = (slug: string, userId: string): string =>
  `${roleHref(slug)}/users/${encodeURIComponent(userId)}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Old uuid links keep working; new ones are slugs. */
export const looksLikeUuid = (v: string): boolean => UUID_RE.test(v);

// ════════════════════════════════════════════════════════════════════
// Per-page level
// ════════════════════════════════════════════════════════════════════

/**
 * What a role can do with ONE page.
 *
 * There is no "write without read": a permission set containing only
 * `orders.write` would let an account POST to an endpoint whose page it
 * cannot load. Every transition below maintains that invariant rather than
 * validating it after the fact.
 */
export type PageLevel = "none" | "read" | "write";

export function pageLevel(perms: ReadonlySet<string>, slug: string): PageLevel {
  if (perms.has(writeKey(slug))) return "write";
  if (perms.has(readKey(slug))) return "read";
  return "none";
}

/**
 * Sets one page to an exact level. Preferred over the toggles below when the
 * caller knows the target state (group headers, "copy from role", bulk
 * actions) — cycling to a state you already know is a state machine you do
 * not need.
 */
export function setPageLevel(
  perms: ReadonlySet<string>,
  slug: string,
  level: PageLevel
): Set<string> {
  const next = new Set(perms);
  const r = readKey(slug);
  const w = writeKey(slug);
  switch (level) {
    case "none":
      next.delete(r);
      next.delete(w);
      break;
    case "read":
      next.add(r);
      next.delete(w);
      break;
    case "write":
      next.add(r); // write implies read
      next.add(w);
      break;
  }
  return next;
}

/** Read checkbox. Turning read OFF also turns write off — see `PageLevel`. */
export function toggleRead(perms: ReadonlySet<string>, slug: string): Set<string> {
  return setPageLevel(perms, slug, perms.has(readKey(slug)) ? "none" : "read");
}

/** Write checkbox. Turning write ON also turns read on. */
export function toggleWrite(perms: ReadonlySet<string>, slug: string): Set<string> {
  return setPageLevel(perms, slug, perms.has(writeKey(slug)) ? "read" : "write");
}

// ════════════════════════════════════════════════════════════════════
// Group level
// ════════════════════════════════════════════════════════════════════

/**
 * What a role can do with a whole GROUP of pages.
 *
 * `mixed` is its own state and matters: a header that renders an unchecked
 * box for a group where four of nine pages are granted is lying about the
 * state it is summarising.
 */
export type GroupLevel = PageLevel | "mixed";

export function groupLevel(
  perms: ReadonlySet<string>,
  pages: readonly AdminPage[]
): GroupLevel {
  if (pages.length === 0) return "none";
  const levels = pages.map((p) => pageLevel(perms, p.slug));
  const first = levels[0];
  return levels.every((l) => l === first) ? first : "mixed";
}

/** Applies one level to every page in a group. */
export function setGroupLevel(
  perms: ReadonlySet<string>,
  pages: readonly AdminPage[],
  level: PageLevel
): Set<string> {
  let next = new Set(perms);
  for (const p of pages) next = setPageLevel(next, p.slug, level);
  return next;
}

/**
 * The level a group header advances to when clicked: none → read → write →
 * none. A mixed group levels up to `read` rather than continuing some
 * ambiguous cycle, because the useful thing to do with a half-set group is
 * to make it uniform.
 */
export function nextGroupLevel(current: GroupLevel): PageLevel {
  switch (current) {
    case "none":
      return "read";
    case "read":
      return "write";
    case "write":
      return "none";
    case "mixed":
      return "read";
  }
}

// ════════════════════════════════════════════════════════════════════
// Whole-role summary
// ════════════════════════════════════════════════════════════════════

/**
 * The headline a roles LIST needs: one phrase for what this role can do.
 * `full` is reserved for a role holding every key in the registry, so it
 * means "everything", not merely "a lot".
 */
export type PermissionLevel = "full" | "readwrite" | "readonly" | "none";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  full: "Full access",
  readwrite: "Read & write",
  readonly: "Read only",
  none: "No access",
};

export function permissionLevel(
  perms: ReadonlySet<string>,
  pages: readonly AdminPage[] = ADMIN_PAGES
): PermissionLevel {
  let reads = 0;
  let writes = 0;
  for (const p of pages) {
    const l = pageLevel(perms, p.slug);
    if (l === "read") reads++;
    else if (l === "write") {
      reads++;
      writes++;
    }
  }
  if (reads === 0) return "none";
  if (reads === pages.length && writes === pages.length) return "full";
  return writes > 0 ? "readwrite" : "readonly";
}

export type RoleCoverage = {
  /** Pages with at least read access. */
  pages: number;
  /** Pages with write access. */
  writablePages: number;
  /** Distinct groups touched — the screen's "Modules" column. */
  modules: number;
  totalPages: number;
  totalModules: number;
};

export function roleCoverage(
  perms: ReadonlySet<string>,
  pages: readonly AdminPage[] = ADMIN_PAGES
): RoleCoverage {
  const modules = new Set<string>();
  let granted = 0;
  let writable = 0;
  for (const p of pages) {
    const l = pageLevel(perms, p.slug);
    if (l === "none") continue;
    granted++;
    modules.add(p.group);
    if (l === "write") writable++;
  }
  return {
    pages: granted,
    writablePages: writable,
    modules: modules.size,
    totalPages: pages.length,
    totalModules: new Set(pages.map((p) => p.group)).size,
  };
}

// ════════════════════════════════════════════════════════════════════
// Drift
// ════════════════════════════════════════════════════════════════════

/**
 * Stored grants that no longer name a page in the registry.
 *
 * These accumulate when a page is removed but its rows are not: Super Admin
 * currently carries `settings-api-keys.read/write` for a page that no longer
 * exists. They grant nothing — every gate checks a key the registry defines —
 * but they make the permission count misleading, which is exactly when an
 * audit stops being trusted. The editor surfaces them so they can be dropped.
 */
export function orphanGrants(perms: Iterable<string>): string[] {
  return [...perms].filter((k) => !ADMIN_PERMISSION_KEYS.has(k)).sort();
}

/**
 * Registry keys this role does NOT hold. Only interesting for a role that is
 * supposed to hold everything — Super Admin is four keys short of the
 * registry today, which no screen currently shows.
 */
export function missingGrants(perms: ReadonlySet<string>): string[] {
  return [...ADMIN_PERMISSION_KEYS].filter((k) => !perms.has(k)).sort();
}

// ════════════════════════════════════════════════════════════════════
// Diff
// ════════════════════════════════════════════════════════════════════

export type PermissionDiff = {
  added: string[];
  removed: string[];
  count: number;
};

/**
 * What the operator has changed but not yet saved.
 *
 * Drives both the unsaved-changes guard and the per-row change marks. A save
 * button that says "Save 6 changes" is a different, better promise than one
 * that says "Save".
 */
export function permissionDiff(
  original: ReadonlySet<string>,
  current: ReadonlySet<string>
): PermissionDiff {
  const added = [...current].filter((k) => !original.has(k)).sort();
  const removed = [...original].filter((k) => !current.has(k)).sort();
  return { added, removed, count: added.length + removed.length };
}

/** Whether one page's level differs from the saved state — for the row mark. */
export function pageChanged(
  original: ReadonlySet<string>,
  current: ReadonlySet<string>,
  slug: string
): boolean {
  return pageLevel(original, slug) !== pageLevel(current, slug);
}

// ════════════════════════════════════════════════════════════════════
// Grouping
// ════════════════════════════════════════════════════════════════════

export type PageGroup = { name: string; pages: AdminPage[] };

/**
 * Pages bucketed by group, in registry order, optionally narrowed by a search
 * term. Empty groups are dropped so a search does not leave a column of
 * headers with nothing under them.
 */
export function groupPages(
  pages: readonly AdminPage[],
  groups: readonly string[],
  query = ""
): PageGroup[] {
  const q = query.trim().toLowerCase();
  const match = (p: AdminPage) =>
    !q || p.label.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);

  return groups
    .map((name) => ({ name, pages: pages.filter((p) => p.group === name && match(p)) }))
    .filter((g) => g.pages.length > 0);
}

// ════════════════════════════════════════════════════════════════════
// Row shape
// ════════════════════════════════════════════════════════════════════

/**
 * One role as the list screen needs it.
 *
 * Lives here rather than beside its query because the roles TABLE is a client
 * component. A type-only import from `server/repos/` is erased at compile and
 * would have been safe — but the dev server has already served a broken
 * bundle twice from this boundary, and a rule that has no exceptions is
 * cheaper to keep than one that has one safe-looking exception.
 */
export type RoleListRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  updatedAt: string;
  userCount: number;
  /**
   * Raw grant keys, orphans included. The screen derives level, coverage and
   * drift from this with the helpers above, so the list and the editor can
   * never disagree about what a set means.
   */
  permissions: string[];
};
