/**
 * Administration → Roles → one role.
 *
 * Three tabs, chosen by what an administrator actually needs to know before
 * changing a role: what it grants, who it affects, and what has been done to
 * it. Each is fetched only when open, which is the point of driving tabs from
 * the URL rather than from client state.
 *
 * ── On the tab that is not here ─────────────────────────────────────────
 * An "Access Scope" tab would be the natural fourth — but scope is not a role
 * property in this system. An account's reach is `users.school_id`, set per
 * user, so the scope of a role is whatever its holders happen to be scoped
 * to. Rendering an empty Access Scope tab here would imply a control that
 * does not exist; the Users tab shows each holder's real scope instead.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, History, KeyRound, Users as UsersIcon } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  ADMIN_PAGES,
  ADMIN_PERMISSION_GROUPS,
  canWritePage,
} from "@/lib/admin-permissions";
import {
  PageHeader,
  Card,
  EmptyState,
  Td,
  Th,
  Tr,
} from "@/components/admin/ui/primitives";
import { Tabs, resolveTab, type TabItem } from "@/components/admin/ui/tabs";
import { RecordHistory } from "@/components/admin/RecordHistory";
import {
  ROLE_USERS_LIMIT,
  getRole,
  listRoleUsers,
} from "@/server/repos/admin-roles";
import { permissionLevel, roleCoverage, roleHref, roleHolderHref } from "@/lib/admin-roles-view";
import { PermissionMatrix } from "@/components/admin/roles/PermissionMatrix";
import {
  CoverageMeter,
  PermissionLevelBadge,
  RoleTypeBadge,
  formatDay,
} from "@/components/admin/roles/presentation";
import {
  ExceptionBadge,
  LastLogin,
  UserIdentity,
  UserStatusBadge,
} from "@/components/admin/users/presentation";

export const dynamic = "force-dynamic";

export default async function RoleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await requireAnyPermission("roles.read", "roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { id } = await params;
  const role = await getRole(id);
  if (!role) notFound();

  const canWrite = canWritePage(guard.permissions, "roles");
  const perms = new Set(role.permissions);
  const coverage = roleCoverage(perms);

  const TABS: TabItem[] = [
    { key: "permissions", label: "Permissions", icon: <KeyRound className="h-3.5 w-3.5" /> },
    {
      key: "users",
      label: "Users",
      count: role.userCount,
      icon: <UsersIcon className="h-3.5 w-3.5" />,
    },
    { key: "activity", label: "Activity", icon: <History className="h-3.5 w-3.5" /> },
  ];
  const sp = await searchParams;
  const tab = resolveTab(sp.tab, TABS);
  const hrefFor = (key: string) =>
    roleHref(role.slug, key === TABS[0].key ? undefined : (key as "users" | "activity"));

  // Only the open tab's data is fetched.
  const users = tab === "users" ? await listRoleUsers(role.id) : [];

  return (
    <div>
      <Link
        href="/admin/roles"
        className="inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft className="h-3 w-3" /> All roles
      </Link>

      <PageHeader
        breadcrumb={[{ label: "Roles", href: "/admin/roles" }, { label: role.name }]}
        title={role.name}
        description={role.description?.trim() || "No description set."}
        actions={
          <div className="flex items-center gap-2">
            <RoleTypeBadge isSystem={role.isSystem} />
            <PermissionLevelBadge level={permissionLevel(perms)} />
          </div>
        }
      />

      {/* Facts an operator needs BEFORE editing: how far this role reaches and
          how many people the edit will affect. One dense strip, no cards. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-100 bg-white px-4 py-2.5">
        <Fact label="Page access">
          <CoverageMeter coverage={coverage} />
        </Fact>
        <Fact label="Modules">
          <span className="text-[13px] tabular-nums text-ink-800">
            <span className="font-semibold">{coverage.modules}</span>
            <span className="text-ink-400"> / {coverage.totalModules}</span>
          </span>
        </Fact>
        <Fact label="Users assigned">
          {role.userCount > 0 ? (
            <Link
              href={`/admin/settings/users?role=${encodeURIComponent(role.id)}`}
              className="text-[13px] font-semibold tabular-nums text-ink-900 hover:text-brand-700 hover:underline"
            >
              {role.userCount}
            </Link>
          ) : (
            <span className="text-[13px] tabular-nums text-ink-400">0</span>
          )}
        </Fact>
        <Fact label="Identifier">
          <span className="font-mono text-[12px] text-ink-600">{role.slug}</span>
        </Fact>
        <Fact label="Created">
          <span className="text-[12.5px] tabular-nums text-ink-700">
            {formatDay(role.createdAt)}
          </span>
        </Fact>
        <Fact label="Last modified">
          <span className="text-[12.5px] tabular-nums text-ink-700">
            {formatDay(role.updatedAt)}
          </span>
        </Fact>
      </div>

      <Tabs tabs={TABS} active={tab} hrefFor={hrefFor} className="mb-4" />

      {tab === "permissions" ? (
        <PermissionMatrix
          role={{
            id: role.id,
            name: role.name,
            description: role.description,
            isSystem: role.isSystem,
            isSuperAdmin: role.isSuperAdmin,
            userCount: role.userCount,
            permissions: role.permissions,
          }}
          pages={[...ADMIN_PAGES]}
          groups={[...ADMIN_PERMISSION_GROUPS]}
          canWrite={canWrite}
        />
      ) : null}

      {tab === "users" ? (
        <Card padded={false} className="overflow-hidden">
          {users.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No users hold this role"
              description="Assign it from a user's detail page. A role with no holders can be deleted safely."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="bg-cream-50 border-b border-ink-100">
                    <tr>
                      <Th>User</Th>
                      <Th className="whitespace-nowrap">Exceptions</Th>
                      <Th>Status</Th>
                      <Th>Last login</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <Tr key={u.id}>
                        <Td>
                          {/* Stays inside Roles & permissions: the holder's
                              access is shown as a sub-page of THIS role, not
                              by jumping across to the Users section. */}
                          <Link
                            href={roleHolderHref(role.slug, u.id)}
                            className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                          >
                            <UserIdentity
                              name={u.name}
                              email={u.email}
                              muted={u.status === "blocked"}
                            />
                          </Link>
                        </Td>
                        <Td>
                          {/* The one column this tab adds over the Users list:
                              who follows the role exactly, and who has been
                              given more or less than it. */}
                          {u.grantCount + u.revokeCount > 0 ? (
                            <ExceptionBadge grants={u.grantCount} revokes={u.revokeCount} />
                          ) : (
                            <span className="text-[11.5px] text-ink-400">Follows role</span>
                          )}
                        </Td>
                        <Td>
                          <UserStatusBadge status={u.status} />
                        </Td>
                        <Td>
                          <LastLogin iso={u.lastLoginAt} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* The tab answers "who does this affect", not "browse users" —
                  past the cap, hand over to the screen built for that. */}
              {role.userCount > users.length ? (
                <div className="border-t border-ink-100 px-4 py-2.5 text-[12.5px] text-ink-500">
                  Showing the first {ROLE_USERS_LIMIT} of {role.userCount}.{" "}
                  <Link
                    href={`/admin/settings/users?role=${encodeURIComponent(role.id)}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    Open in Users
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {tab === "activity" ? (
        <RecordHistory entityType="admin_role" entityId={role.id} title="Role history" />
      ) : null}
    </div>
  );
}

/** One labelled fact in the header strip. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
