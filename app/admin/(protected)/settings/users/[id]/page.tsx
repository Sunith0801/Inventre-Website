/**
 * Administration → Users → one user (Overview / Activity).
 *
 * The record: who they are, which role they hold, what has been done to the
 * account. Their permissions are a sibling route (`./access`) sharing this
 * same shell — see `UserDetailShell` for why the tab bar spans two routes.
 *
 * Gated on `settings-users.*`, the same grant that puts an operator on the
 * Users list. The page needed `roles.write` only while it carried the
 * permission grid; that grid now lives on the Roles and Access screens.
 */

import { notFound, redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import { RecordHistory } from "@/components/admin/RecordHistory";
import { countActiveSuperAdmins, getAdminUser, listAllSchools } from "@/server/repos/admin-users";
import { listRoles } from "@/server/repos/admin-roles";
import { RoleAssignment } from "@/components/admin/users/RoleAssignment";
import { UserProfileCard } from "@/components/admin/users/UserProfileCard";
import { AccountActionsCard } from "@/components/admin/users/AccountActionsCard";
import { UserDetailShell } from "@/components/admin/users/UserDetailShell";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await requireAnyPermission("settings-users.read", "settings-users.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "activity" ? "activity" : "overview";

  // Everything but the user itself is only needed by the Overview tab.
  const overview = tab === "overview";
  const [user, roles, schools, activeSuperCount] = await Promise.all([
    getAdminUser(id),
    overview ? listRoles() : Promise.resolve([]),
    overview ? listAllSchools() : Promise.resolve([]),
    overview ? countActiveSuperAdmins() : Promise.resolve(0),
  ]);
  if (!user) notFound();

  const canWrite = canWritePage(guard.permissions, "settings-users");

  return (
    <UserDetailShell user={user} active={tab}>
      {tab === "overview" ? (
        // Three cards, in the order an administrator reads them: who this is,
        // what they can do, and the sensitive switches — kept last so a
        // "Lock" button is never the first thing under the fold.
        <div className="space-y-4">
          <UserProfileCard
            user={{ id: user.id, name: user.name, email: user.email }}
            canWrite={canWrite}
          />
          <div className="grid gap-4 lg:grid-cols-2 items-start">
          <RoleAssignment
              user={{
                id: user.id,
                email: user.email,
                name: user.name,
                roleId: user.roleId,
                schoolId: user.schoolId,
                isSelf: guard.id === user.id,
              }}
              schools={schools}
              canEditRoles={guard.permissions.has("roles.write")}
              roles={roles.map((r) => ({
                id: r.id,
                slug: r.slug,
                name: r.name,
                description: r.description,
                isSystem: r.isSystem,
              }))}
              canWrite={canWrite}
            />
            <AccountActionsCard
              user={{
                id: user.id,
                name: user.name,
                email: user.email,
                status: user.status,
                legacyRole: user.legacyRole,
                isSelf: guard.id === user.id,
              }}
              activeSuperCount={activeSuperCount}
              canWrite={canWrite}
            />
          </div>
        </div>
      ) : (
        <RecordHistory entityType="user" entityId={user.id} title="Account history" />
      )}
    </UserDetailShell>
  );
}
