import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { ADMIN_PAGES, ADMIN_PERMISSION_GROUPS } from "@/lib/admin-permissions";
import { UserPermissionsEditor } from "@/components/admin/UserPermissionsEditor";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Only super-admin (or any role with roles.write) can manage user
  // permissions — same gate the role editor uses.
  const guard = await requirePermission("roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const { id } = await params;

  const [user] = (await db.execute(sql`
    SELECT u.id, u.email, u.name, u.role, u.role_id, u.school_id, u.status
      FROM users u WHERE u.id = ${id} LIMIT 1
  `)) as unknown as {
    id: string;
    email: string;
    name: string | null;
    role: "super" | "ops" | "school_admin";
    role_id: string | null;
    school_id: string | null;
    status: "active" | "blocked" | "pending";
  }[];
  if (!user) notFound();

  // All roles for the picker (system + custom).
  const roles = (await db.execute(sql`
    SELECT id, slug, name, description, is_system FROM admin_roles
     ORDER BY is_system DESC, lower(name)
  `)) as unknown as {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_system: boolean;
  }[];

  // Role's baseline permission set — for the "inherited from role" column
  // of the override grid.
  const rolePerms = user.role_id
    ? ((await db.execute(sql`
        SELECT permission FROM admin_role_permissions WHERE role_id = ${user.role_id}
      `)) as unknown as { permission: string }[])
    : [];

  // Existing per-user overrides.
  const overrides = (await db.execute(sql`
    SELECT permission, granted FROM admin_user_permissions WHERE user_id = ${id}
  `)) as unknown as { permission: string; granted: boolean }[];

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/settings/users"
        className="text-[12.5px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-3 w-3" /> All admin users
      </Link>
      <UserPermissionsEditor
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          roleId: user.role_id,
          status: user.status,
          isSelf: guard.id === user.id,
        }}
        roles={roles.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          isSystem: r.is_system,
        }))}
        pages={ADMIN_PAGES}
        groups={[...ADMIN_PERMISSION_GROUPS]}
        rolePerms={rolePerms.map((r) => r.permission)}
        overrides={overrides.map((o) => ({ permission: o.permission, granted: o.granted }))}
      />

      <div className="mt-5">
        <RecordHistory entityType="user" entityId={id} title="User history" />
      </div>
    </div>
  );
}
