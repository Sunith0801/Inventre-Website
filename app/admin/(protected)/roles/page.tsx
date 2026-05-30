import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { PageHeader, Button, Badge, Card, Th, Td, Tr } from "@/components/admin/ui/primitives";
import { Plus, KeyRound } from "lucide-react";
import { requirePermission } from "@/lib/admin-guard";
import { isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const guard = await requirePermission("roles.read");
  if (isResponse(guard)) redirect("/admin/dashboard");

  // List roles with per-role counts (permission count + assigned-user count).
  const rows = (await db.execute(sql`
    SELECT r.id, r.slug, r.name, r.description, r.is_system,
           (SELECT COUNT(*) FROM admin_role_permissions p WHERE p.role_id = r.id)::int AS n_perms,
           (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id)::int AS n_users
      FROM admin_roles r
     ORDER BY r.is_system DESC, lower(r.name)
  `)) as unknown as {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_system: boolean;
    n_perms: number;
    n_users: number;
  }[];

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title="Roles & permissions"
        description={`${rows.length} role${rows.length === 1 ? "" : "s"}. System roles are seeded and can't be deleted; their permissions are editable except for Super Admin (always all).`}
        actions={
          <Link href="/admin/roles/new">
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>New role</Button>
          </Link>
        }
      />
      <Card padded={false}>
        <table className="w-full text-[14px]">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Permissions</Th>
              <Th>Users</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/admin/roles/${r.id}`} className="font-semibold text-ink-900 hover:text-brand-700 inline-flex items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5 text-ink-400" />
                    {r.name}
                    {r.is_system && <Badge tone="info" size="sm">System</Badge>}
                  </Link>
                </Td>
                <Td muted className="max-w-md">{r.description ?? "—"}</Td>
                <Td muted>{r.n_perms}</Td>
                <Td muted>{r.n_users}</Td>
                <Td>
                  <Link href={`/admin/roles/${r.id}`} className="text-[12px] text-brand-700 hover:underline">Edit →</Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
