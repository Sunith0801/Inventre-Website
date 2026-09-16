/**
 * Administration → Roles → one role → Users → one holder.
 *
 * The same access matrix the Users section shows at
 * `/admin/settings/users/<id>/access`, framed from the ROLE's side. An
 * administrator reviewing the Operations role and clicking a holder wants to
 * know how that person differs from the role they are looking at — and wants
 * to still be in Roles & permissions when they find out, with a way back to
 * the list of holders. Jumping them across to the Users section answered the
 * question in the wrong place.
 *
 * Same component, two doors: from Users you get the user-framed page, from
 * Roles you get this. The editor and the data are identical either way.
 *
 * The URL asserts that <userId> holds <id>; if they do not, it 404s rather
 * than rendering a matrix that compares a person to a role they are not in.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  ADMIN_PAGES,
  ADMIN_PERMISSION_GROUPS,
  canWritePage,
} from "@/lib/admin-permissions";
import { PageHeader, Badge } from "@/components/admin/ui/primitives";
import { getRole } from "@/server/repos/admin-roles";
import { roleHref } from "@/lib/admin-roles-view";
import { getAdminUser, getUserAccess } from "@/server/repos/admin-users";
import { AccessMatrix } from "@/components/admin/users/AccessMatrix";
import { ExceptionBadge, UserStatusBadge } from "@/components/admin/users/presentation";

export const dynamic = "force-dynamic";

export default async function RoleHolderAccessPage({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}) {
  const guard = await requireAnyPermission("roles.read", "roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { id, userId } = await params;
  const [role, user, access] = await Promise.all([
    getRole(id),
    getAdminUser(userId),
    getUserAccess(userId),
  ]);
  if (!role || !user || !access) notFound();
  // The path claims this user holds this role. Refuse to render a comparison
  // against a role the user is not actually in.
  if (user.roleId !== role.id) notFound();

  const canWrite = canWritePage(guard.permissions, "roles");
  const display = user.name?.trim() || user.email;
  const usersTab = roleHref(role.slug, "users");

  return (
    <div>
      <Link
        href={usersTab}
        className="inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft className="h-3 w-3" /> {role.name} users
      </Link>

      <PageHeader
        breadcrumb={[{ label: "Roles", href: "/admin/roles" }, { label: role.name, href: roleHref(role.slug) }, { label: "Users", href: usersTab }, { label: display }]}
        eyebrow={`${role.name} · access`}
        title={display}
        description={user.email}
        actions={
          <div className="flex items-center gap-2">
            <UserStatusBadge status={user.status} />
            <Badge size="sm" tone="subtle">
              {role.name}
            </Badge>
            <ExceptionBadge grants={user.grantCount} revokes={user.revokeCount} />
          </div>
        }
      />

      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-600">
        What <span className="font-semibold text-ink-900">{display}</span> can do, compared
        with what the <span className="font-semibold text-ink-900">{role.name}</span> role
        gives everyone. Changes here affect this one account only — to change every{" "}
        {role.name} holder at once,{" "}
        <Link href={roleHref(role.slug)} className="font-semibold text-brand-700 hover:underline">
          edit the role
        </Link>
        .
      </p>

      <AccessMatrix
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          roleName: role.name,
          isSelf: guard.id === user.id,
        }}
        pages={[...ADMIN_PAGES]}
        groups={[...ADMIN_PERMISSION_GROUPS]}
        baseline={access.baseline}
        savedOverrides={access.overrides}
        canWrite={canWrite}
      />
    </div>
  );
}
