import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { ADMIN_PERMISSION_KEYS } from "@/lib/admin-permissions";
import { logActivity } from "@/lib/activity";

const Body = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(z.string().min(1)).default([]),
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "role";
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission("nav:roles");
  if (isResponse(guard)) return guard;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const { name, description, permissions } = parsed.data;

  // Validate every permission against the registry — refuse junk keys.
  for (const p of permissions) {
    if (!ADMIN_PERMISSION_KEYS.has(p)) {
      return NextResponse.json({ error: `Unknown permission key: ${p}` }, { status: 400 });
    }
  }

  // Slug must be unique; suffix on collision.
  let slug = slugify(name);
  let attempt = 0;
  while (attempt < 5) {
    const [existing] = (await db.execute(sql`SELECT id FROM admin_roles WHERE slug = ${slug} LIMIT 1`)) as unknown as { id: string }[];
    if (!existing) break;
    attempt++;
    slug = `${slugify(name)}-${attempt + 1}`;
  }

  const [row] = (await db.execute(sql`
    INSERT INTO admin_roles (slug, name, description, is_system)
    VALUES (${slug}, ${name}, ${description ?? null}, false)
    RETURNING id
  `)) as unknown as { id: string }[];

  if (permissions.length > 0) {
    await db.execute(sql`
      INSERT INTO admin_role_permissions (role_id, permission) VALUES ${sql.join(
        permissions.map((p) => sql`(${row.id}, ${p})`),
        sql`, `,
      )}
      ON CONFLICT DO NOTHING
    `);
  }

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "admin.role.create",
    entityType: "admin_role",
    entityId: row.id,
    summary: `Created role "${name}" with ${permissions.length} permission(s)`,
  });

  return NextResponse.json({ id: row.id, redirectTo: `/admin/roles/${row.id}` });
}
