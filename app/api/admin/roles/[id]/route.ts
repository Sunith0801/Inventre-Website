import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { ADMIN_PERMISSION_KEYS } from "@/lib/admin-permissions";
import { logActivity } from "@/server/activity";

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(z.string().min(1)).optional(),
});

async function loadRole(id: string) {
  const [row] = (await db.execute(sql`
    SELECT id, slug, name, is_system FROM admin_roles WHERE id = ${id} LIMIT 1
  `)) as unknown as { id: string; slug: string; name: string; is_system: boolean }[];
  return row;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("roles.write");
  if (isResponse(guard)) return guard;
  const { id } = await ctx.params;

  const role = await loadRole(id);
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const { name, description, permissions } = parsed.data;

  if (permissions) {
    for (const p of permissions) {
      if (!ADMIN_PERMISSION_KEYS.has(p)) {
        return NextResponse.json({ error: `Unknown permission key: ${p}` }, { status: 400 });
      }
    }
  }

  await db.transaction(async (tx) => {
    if (name !== undefined || description !== undefined) {
      await tx.execute(sql`
        UPDATE admin_roles
           SET name = COALESCE(${name ?? null}, name),
               description = ${description !== undefined ? description : sql`description`},
               updated_at = now()
         WHERE id = ${id}
      `);
    }

    if (permissions !== undefined) {
      // Super Admin is always all-on. Refuse any attempt to remove
      // permissions for it — replace with the full set instead.
      const finalPerms = role.slug === "super-admin"
        ? [...ADMIN_PERMISSION_KEYS]
        : permissions;
      await tx.execute(sql`DELETE FROM admin_role_permissions WHERE role_id = ${id}`);
      if (finalPerms.length > 0) {
        await tx.execute(sql`
          INSERT INTO admin_role_permissions (role_id, permission) VALUES ${sql.join(
            finalPerms.map((p) => sql`(${id}, ${p})`),
            sql`, `,
          )}
        `);
      }
    }
  });

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "admin.role.update",
    entityType: "admin_role",
    entityId: id,
    summary: `Updated role "${name ?? role.name}"`,
    diff: { name: name ?? null, description: description ?? null, permissions: permissions ?? null },
  });

  return NextResponse.json({ ok: true, redirectTo: `/admin/roles/${id}` });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("roles.write");
  if (isResponse(guard)) return guard;
  const { id } = await ctx.params;

  const role = await loadRole(id);
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  if (role.is_system) {
    return NextResponse.json({ error: "System roles cannot be deleted." }, { status: 400 });
  }

  const [{ n }] = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM users WHERE role_id = ${id}`)) as unknown as { n: number }[];
  if (n > 0) {
    return NextResponse.json({ error: `${n} user(s) still assigned. Reassign them first.` }, { status: 400 });
  }

  await db.execute(sql`DELETE FROM admin_roles WHERE id = ${id}`);

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "admin.role.delete",
    entityType: "admin_role",
    entityId: id,
    summary: `Deleted role "${role.name}"`,
  });

  return NextResponse.json({ ok: true });
}
