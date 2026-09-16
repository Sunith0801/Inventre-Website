/**
 * Administration → Users → one user → Access.
 *
 * Its own route, not a panel inside the record. Granting one person an extra
 * module — or taking one away — is a deliberate security act with its own
 * audit trail, and it deserves a URL that can be linked in a ticket and
 * bookmarked during an access review. The Roles → Users tab lands here, so
 * clicking a role-holder answers "what can THIS person do" rather than
 * bouncing to their profile.
 *
 * Shares `UserDetailShell` with the record page: same header, same facts,
 * same tab bar. Only what sits under the tabs differs.
 *
 * The distinction this screen exists to make:
 *
 *   ROLE    what a job title can do   — edited at /admin/roles
 *   ACCESS  what THIS person can do   — edited here, as exceptions
 *
 * Viewing is gated on `roles.read`; the Save endpoint requires `roles.write`,
 * and `canWrite` keeps the UI honest about which the operator holds.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  ADMIN_PAGES,
  ADMIN_PERMISSION_GROUPS,
  canWritePage,
} from "@/lib/admin-permissions";
import { getAdminUser, getUserAccess } from "@/server/repos/admin-users";
import { AccessMatrix } from "@/components/admin/users/AccessMatrix";
import { roleHref } from "@/lib/admin-roles-view";
import { UserDetailShell } from "@/components/admin/users/UserDetailShell";

export const dynamic = "force-dynamic";

export default async function UserAccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAnyPermission("roles.read", "roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { id } = await params;
  const [user, access] = await Promise.all([getAdminUser(id), getUserAccess(id)]);
  if (!user || !access) notFound();

  const canWrite = canWritePage(guard.permissions, "roles");

  return (
    <UserDetailShell user={user} active="access">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-ink-600">
        <p>
          Exceptions layered on top of the{" "}
          <span className="font-semibold text-ink-900">{access.roleName}</span> role. The
          role decides the baseline; everything set here is a deliberate departure from
          it.
        </p>
        {user.roleSlug && guard.permissions.has("roles.write") ? (
          <Link
            href={roleHref(user.roleSlug)}
            className="font-semibold text-brand-700 hover:underline"
          >
            Edit the {access.roleName} role instead →
          </Link>
        ) : null}
      </div>

      <AccessMatrix
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          roleName: access.roleName,
          isSelf: guard.id === user.id,
        }}
        pages={[...ADMIN_PAGES]}
        groups={[...ADMIN_PERMISSION_GROUPS]}
        baseline={access.baseline}
        savedOverrides={access.overrides}
        canWrite={canWrite}
      />
    </UserDetailShell>
  );
}
