/**
 * Users screen — vocabulary, filter parsing and URL building.
 *
 * ── Why this is separate from `server/repos/admin-users.ts` ─────────────
 * The table is a client component and needs `usersHref` to build its sort
 * links. Importing that from the repo module dragged `db/client` → `postgres`
 * → node's `net`/`tls` into the browser bundle, and the production build
 * failed with "Module not found: Can't resolve 'net'".
 *
 * Types would have been fine — they erase at compile time. A FUNCTION does
 * not: importing one pulls in its whole module graph. So everything both
 * sides need lives here, with no database import, and the repo module keeps
 * only what touches SQL.
 *
 * The rule this file encodes: shared code imports downward into `lib/`,
 * never sideways into `server/`.
 */

// ════════════════════════════════════════════════════════════════════
// Status
// ════════════════════════════════════════════════════════════════════

/**
 * The `account_status` enum has exactly three values. The screen labels
 * `blocked` as "Locked", which is what it means operationally — the account
 * exists and is refused at the door.
 *
 * Note there is no `inactive`: "Lock user" and "Deactivate user" would both
 * write `blocked`, so the UI offers ONE action rather than two menu items
 * that quietly do the same thing. Splitting them is a migration, not a
 * component change.
 */
export const USER_STATUSES = ["active", "blocked", "pending"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  blocked: "Locked",
  pending: "Pending",
};

export function isUserStatus(v: string): v is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(v);
}

// ════════════════════════════════════════════════════════════════════
// Last-login windows
// ════════════════════════════════════════════════════════════════════

/**
 * "Last login" is a derived filter, not a column — these are the windows an
 * administrator actually audits by. `stale` is the security-relevant one:
 * live credentials nobody has used in a quarter.
 *
 * The labels live here; the SQL that implements each window lives in the repo
 * module, keyed by these same tokens.
 */
export const LAST_LOGIN_LABELS = {
  never: "Never logged in",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  stale: "Over 90 days ago",
} as const;

export type LastLoginWindow = keyof typeof LAST_LOGIN_LABELS;

export function isLastLoginWindow(v: string): v is LastLoginWindow {
  return Object.prototype.hasOwnProperty.call(LAST_LOGIN_LABELS, v);
}

// ════════════════════════════════════════════════════════════════════
// Sorting
// ════════════════════════════════════════════════════════════════════

/**
 * Sortable columns as URL tokens. The repo module maps each to a SQL
 * expression; that map is the only thing allowed near `sql.raw`, and it can
 * only ever be keyed by one of these.
 */
export const SORT_KEYS = [
  "user",
  "role",
  "school",
  "status",
  "lastLogin",
  "created",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export function isSortKey(v: string): v is SortKey {
  return (SORT_KEYS as readonly string[]).includes(v);
}

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 50;

// ════════════════════════════════════════════════════════════════════
// Filters
// ════════════════════════════════════════════════════════════════════

export type UserFilters = {
  q: string;
  roleId: string | null;
  schoolId: string | null;
  status: UserStatus | null;
  lastLogin: LastLoginWindow | null;
  sort: SortKey;
  dir: SortDir;
  page: number;
  perPage: number;
};

/** The shape Next hands a server page after awaiting `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : (v ?? "")).trim();

/**
 * URL → filters. Every unrecognised value falls back to its default rather
 * than throwing: a hand-edited or stale query string should render the
 * default screen, never a 500.
 */
export function parseUserFilters(sp: RawSearchParams): UserFilters {
  const status = one(sp.status);
  const lastLogin = one(sp.lastLogin);
  const sort = one(sp.sort);
  const dir = one(sp.dir);
  const perPage = Number.parseInt(one(sp.perPage), 10);
  const page = Number.parseInt(one(sp.page), 10);

  return {
    q: one(sp.q).slice(0, 120),
    roleId: one(sp.role) || null,
    schoolId: one(sp.school) || null,
    status: isUserStatus(status) ? status : null,
    lastLogin: isLastLoginWindow(lastLogin) ? lastLogin : null,
    sort: isSortKey(sort) ? sort : "user",
    dir: dir === "desc" ? "desc" : "asc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage)
      ? perPage
      : DEFAULT_PER_PAGE,
  };
}

/** True when anything is narrowing the list — drives the "Clear filters" chip. */
export function hasActiveFilters(f: UserFilters): boolean {
  return Boolean(f.q || f.roleId || f.schoolId || f.status || f.lastLogin);
}

/** The filter set as query params. Shared by the page URL and the export URL. */
function toParams(f: UserFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.roleId) p.set("role", f.roleId);
  if (f.schoolId) p.set("school", f.schoolId);
  if (f.status) p.set("status", f.status);
  if (f.lastLogin) p.set("lastLogin", f.lastLogin);
  return p;
}

/**
 * Filters → `/admin/settings/users?…`, carrying every active filter forward
 * and overriding any subset. Centralised so a sort link, a facet tile and a
 * pagination arrow cannot each build the URL slightly differently — which is
 * how filters get silently dropped on navigation.
 */
export function usersHref(
  f: UserFilters,
  overrides: Partial<UserFilters> = {}
): string {
  const merged = { ...f, ...overrides };
  const p = toParams(merged);
  if (merged.sort !== "user") p.set("sort", merged.sort);
  if (merged.dir !== "asc") p.set("dir", merged.dir);
  if (merged.perPage !== DEFAULT_PER_PAGE) p.set("perPage", String(merged.perPage));
  // Any change of filter resets to page 1 unless the caller asked for a page
  // explicitly — paging to 7 of a result set you just re-filtered is a
  // guaranteed empty screen.
  const page = overrides.page ?? (Object.keys(overrides).length ? 1 : merged.page);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return `/admin/settings/users${qs ? `?${qs}` : ""}`;
}

/**
 * The same filter set, pointed at the CSV endpoint.
 *
 * Export must honour exactly what is on screen — an operator who filtered to
 * "locked, never logged in" and then exported the unfiltered table has been
 * handed the wrong file, and nothing about it says so. Sharing `toParams`
 * with `usersHref` is what keeps the two in step.
 */
export function usersExportHref(f: UserFilters): string {
  const p = toParams(f);
  p.set("sort", f.sort);
  p.set("dir", f.dir);
  return `/api/admin/users/export?${p.toString()}`;
}

// ════════════════════════════════════════════════════════════════════
// Row shape
// ════════════════════════════════════════════════════════════════════

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  /** RBAC role. Null for accounts still on the legacy enum alone. */
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  isSystemRole: boolean;
  /** The legacy `user_role` enum — still enforced by unmigrated callsites. */
  legacyRole: string;
  /**
   * The school this account is scoped to. This is the real access-scope
   * dimension in this business, and the column the screen labels "Scope".
   * Null means unscoped — the account sees every school.
   */
  schoolId: string | null;
  schoolName: string | null;
  /**
   * Explicit exceptions layered on the role: how many keys this user has been
   * granted beyond it, and how many revoked from it. Seven of ten accounts in
   * production carry at least one; one carries sixteen. A user row that does
   * not show this is hiding the single most audit-relevant fact about it.
   */
  grantCount: number;
  revokeCount: number;
};
