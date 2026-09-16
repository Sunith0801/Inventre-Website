/**
 * Administration → Roles & permissions.
 *
 * Thin by design: guard, fetch, render. The permission algebra is in
 * `lib/admin-roles-view.ts`, the SQL in `server/repos/admin-roles.ts`, the
 * markup in `components/admin/roles/`.
 *
 * No search box and no pagination, unlike Users. Roles are authored by hand
 * and there are eight; a filter over eight rows is furniture. The columns do
 * the work instead — how many users hold the role, how much of the product it
 * reaches, and whether its grants have drifted from the registry.
 */

import { redirect } from "next/navigation";
import { KeyRound, ShieldAlert } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import { PageHeader, Card, EmptyState, Stat } from "@/components/admin/ui/primitives";
import { listRoles } from "@/server/repos/admin-roles";
import { orphanGrants } from "@/lib/admin-roles-view";
import { RolesTable } from "@/components/admin/roles/RolesTable";
import { NewRoleDialog } from "@/components/admin/roles/NewRoleDialog";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const guard = await requireAnyPermission("roles.read", "roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const canWrite = canWritePage(guard.permissions, "roles");
  const roles = await listRoles();

  const unused = roles.filter((r) => r.userCount === 0).length;
  const drifted = roles.filter((r) => orphanGrants(r.permissions).length > 0);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Roles & Permissions"
        description="What each role can open and change. Users inherit their role, plus any per-user exceptions."
        actions={
          canWrite ? (
            <NewRoleDialog
              templates={roles.map((r) => ({
                id: r.id,
                name: r.name,
                permissions: r.permissions,
              }))}
            />
          ) : null
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3 lg:gap-4">
        <Stat label="Roles" value={roles.length} />
        <Stat label="System" value={roles.filter((r) => r.isSystem).length} hint="Cannot be deleted" />
        <Stat label="Not assigned" value={unused} hint={unused > 0 ? "Roles with no users" : "Every role is in use"} />
      </div>

      {/*
        Registry drift, surfaced where it can be acted on.

        A grant whose page no longer exists is harmless — every gate checks a
        key the registry defines — but it inflates the permission count, and a
        count nobody can reconcile is how an access review stops being
        believed. Opening the role and saving it drops them.
      */}
      {drifted.length > 0 ? (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[12.5px] leading-relaxed text-amber-900">
            <span className="font-semibold">
              {drifted.length} role{drifted.length === 1 ? "" : "s"} carr
              {drifted.length === 1 ? "ies" : "y"} grants for pages that no longer exist
            </span>{" "}
            ({drifted.map((r) => r.name).join(", ")}). They grant nothing. Open the role
            and save it to clear them.
          </p>
        </div>
      ) : null}

      <Card padded={false} className="overflow-hidden">
        {roles.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No roles defined"
            description="Roles bundle page permissions so they can be granted to staff accounts as a set."
          />
        ) : (
          <RolesTable roles={roles} canWrite={canWrite} />
        )}
      </Card>
    </div>
  );
}
