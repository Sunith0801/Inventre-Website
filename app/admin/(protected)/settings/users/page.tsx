/**
 * Administration → Users.
 *
 * The page is deliberately thin: guard, parse the URL, fetch, render. It
 * contains no SQL (that is `server/repos/admin-users.ts`) and no markup
 * beyond layout (that is `components/admin/users/`). When this file grows a
 * query or a class string, something has been put in the wrong place.
 *
 * What it replaced: a `SELECT *` with no LIMIT rendered into a 4-column list
 * at `max-w-4xl`, with no search, no filters, no pagination, and neither of
 * the two columns — last login and created date — that the table already
 * stored and an administrator most needs.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { Users as UsersIcon, SearchX } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import {
  PageHeader,
  Card,
  Button,
  EmptyState,
  Pagination,
  PerPagePicker,
} from "@/components/admin/ui/primitives";
import {
  PER_PAGE_OPTIONS,
  USER_STATUS_LABEL,
  hasActiveFilters,
  parseUserFilters,
  usersExportHref,
  usersHref,
  type RawSearchParams,
  type UserFilters,
  type UserStatus,
} from "@/lib/admin-users-view";
import {
  adminUserStatusFacets,
  countActiveSuperAdmins,
  listAdminUsers,
  listAllSchools,
  listRoleOptions,
  listScopeOptions,
} from "@/server/repos/admin-users";
import { UsersToolbar } from "@/components/admin/users/UsersToolbar";
import { UsersTable } from "@/components/admin/users/UsersTable";
import { AddUserDialog } from "@/components/admin/users/AddUserDialog";
import { listRoles } from "@/server/repos/admin-roles";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════
// Status facets
// ════════════════════════════════════════════════════════════════════

/**
 * A dense segmented strip, not a row of KPI cards.
 *
 * Four cards would eat 120px of vertical space above the table to show four
 * integers. On an operational screen the table is the point, and the counts
 * are a filter that happens to carry a number. This is one 32px row.
 *
 * Counts honour every active filter EXCEPT status, so narrowing by status
 * never zeroes the tile you would use to widen again.
 */
function StatusFacets({
  filters,
  counts,
}: {
  filters: UserFilters;
  counts: Record<UserStatus, number> & { total: number };
}) {
  const segments: { key: UserStatus | null; label: string; count: number }[] = [
    { key: null, label: "All", count: counts.total },
    { key: "active", label: USER_STATUS_LABEL.active, count: counts.active },
    { key: "blocked", label: USER_STATUS_LABEL.blocked, count: counts.blocked },
    { key: "pending", label: USER_STATUS_LABEL.pending, count: counts.pending },
  ];

  return (
    <div className="mb-3 inline-flex items-center rounded-lg border border-ink-200 bg-white p-0.5">
      {segments.map((s) => {
        const active = filters.status === s.key;
        return (
          <Link
            key={s.label}
            href={usersHref(filters, { status: s.key, page: 1 })}
            aria-current={active ? "true" : undefined}
            className={[
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
              active
                ? "bg-ink-900 text-white"
                : "text-ink-600 hover:bg-cream-100 hover:text-ink-900",
            ].join(" ")}
          >
            {s.label}
            <span
              className={[
                "tabular-nums text-[11px] font-bold",
                active ? "text-white/70" : "text-ink-400",
              ].join(" ")}
            >
              {s.count.toLocaleString("en-IN")}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════════════

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const guard = await requireAnyPermission("settings-users.read", "settings-users.write");
  if (isResponse(guard)) redirect("/admin");

  const filters = parseUserFilters(await searchParams);
  const canWrite = canWritePage(guard.permissions, "settings-users");
  // The per-user ACCESS page edits permission overrides and is gated on
  // `roles.*`. Managing users and managing roles are separate grants, so the
  // table needs to know whether that one link actually leads anywhere.
  const canManageAccess =
    guard.permissions.has("roles.read") || guard.permissions.has("roles.write");

  // Independent reads, issued together. Sequentially these are five
  // round-trips before the first byte; the page is already `force-dynamic`
  // and the queries do not depend on one another.
  const [page, facets, roles, scopes, schools, activeSuperCount, allRoles] = await Promise.all([
    listAdminUsers(filters),
    adminUserStatusFacets(filters),
    listRoleOptions(),
    listScopeOptions(),
    listAllSchools(),
    countActiveSuperAdmins(),
    // The Add-user dialog picks a real role, in hierarchy order.
    listRoles(),
  ]);
  const roleChoices = allRoles.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
  }));

  const filtering = hasActiveFilters(filters);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        actions={canWrite ? <AddUserDialog roles={roleChoices} schools={schools} /> : null}
      />

      <StatusFacets filters={filters} counts={facets} />

      <UsersToolbar
        filters={filters}
        roles={roles}
        scopes={scopes}
        exportHref={usersExportHref(filters)}
      />

      {/* `padded={false}` — the table supplies its own cell padding, and a
          card's inner padding would only push the columns inward and cost a
          column's worth of width on a laptop. */}
      <Card padded={false} className="overflow-hidden">
        {page.rows.length === 0 ? (
          filtering ? (
            <EmptyState
              icon={SearchX}
              title="No users match these filters"
              description="Try widening the search, or clear the filters to see every account."
              action={
                <Link href={usersHref(filters, { q: "", roleId: null, schoolId: null, status: null, lastLogin: null })}>
                  <Button variant="secondary" size="sm">
                    Clear filters
                  </Button>
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={UsersIcon}
              title="No users yet"
              description="Staff accounts that can sign in to the admin panel will appear here."
              action={canWrite ? <AddUserDialog roles={roleChoices} schools={schools} /> : null}
            />
          )
        ) : (
          <>
            <UsersTable
              rows={page.rows}
              filters={filters}
              currentUserId={guard.id}
              canWrite={canWrite}
              canManageAccess={canManageAccess}
              activeSuperCount={activeSuperCount}
            />
            <Pagination
              noun="user"
              page={page.page}
              pages={page.pages}
              from={page.from}
              to={page.to}
              total={page.total}
              hrefFor={(p) => usersHref(filters, { page: p })}
            >
              <PerPagePicker
                value={page.perPage}
                options={PER_PAGE_OPTIONS}
                hrefFor={(pp) => usersHref(filters, { perPage: pp, page: 1 })}
              />
            </Pagination>
          </>
        )}
      </Card>
    </div>
  );
}
