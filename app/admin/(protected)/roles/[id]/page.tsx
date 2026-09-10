import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ChevronLeft } from "lucide-react";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { ADMIN_PAGES, ADMIN_PERMISSION_GROUPS } from "@/lib/admin-permissions";
import { RoleEditor } from "@/components/admin/RoleEditor";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const { id } = await params;

  const [role] = (await db.execute(sql`
    SELECT id, slug, name, description, is_system FROM admin_roles WHERE id = ${id} LIMIT 1
  `)) as unknown as {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_system: boolean;
  }[];
  if (!role) notFound();

  const perms = (await db.execute(sql`
    SELECT permission FROM admin_role_permissions WHERE role_id = ${id}
  `)) as unknown as { permission: string }[];
  const granted = new Set(perms.map((p) => p.permission));

  const [{ n_users }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n_users FROM users WHERE role_id = ${id}
  `)) as unknown as { n_users: number }[];

  return (
    <div className="max-w-4xl">
      <Link href="/admin/roles" className="text-[12.5px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-3 w-3" /> All roles
      </Link>
      <RoleEditor
        role={{
          id: role.id,
          slug: role.slug,
          name: role.name,
          description: role.description ?? "",
          isSystem: role.is_system,
          isSuperAdmin: role.slug === "super-admin",
          assignedUsers: n_users,
        }}
        pages={ADMIN_PAGES}
        groups={[...ADMIN_PERMISSION_GROUPS]}
        granted={[...granted]}
      />

      <div className="mt-5">
        <RecordHistory entityType="admin_role" entityId={id} title="Role history" />
      </div>
    </div>
  );
}
