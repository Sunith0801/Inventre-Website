import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logActivity } from "@/server/activity";
import { isSchoolScopedRole, legacyRoleFor } from "@/lib/admin-roles-view";

/**
 * Create a staff account with a real role (`admin_roles.id`). The legacy
 * three-value `role` enum is still accepted for older callers and mapped to
 * Super Admin / Operations Manager / School; the enum stored on the row is
 * always DERIVED from the assigned role, since every school-scoping query
 * keys on it.
 */
const Body = z
  .object({
    email: z.string().email(),
    name: z.string().nullable().optional(),
    password: z.string().min(6),
    roleId: z.string().uuid().optional(),
    role: z.enum(["super", "ops", "school_admin"]).optional(),
    schoolId: z.string().nullable().optional(),
    status: z.enum(["active", "blocked", "pending"]).default("active"),
  })
  .refine((b) => b.roleId || b.role, { message: "roleId is required" });

const LEGACY_SLUG = { super: "super-admin", ops: "operations", school_admin: "school" } as const;

export async function POST(req: Request) {
  const guard = await requirePermission("settings-users.write");
  if (isResponse(guard)) return guard;
  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [role] = (await db.execute(
    body.roleId
      ? sql`SELECT id, slug, name FROM admin_roles WHERE id = ${body.roleId} LIMIT 1`
      : sql`SELECT id, slug, name FROM admin_roles WHERE slug = ${LEGACY_SLUG[body.role!]} LIMIT 1`,
  )) as unknown as { id: string; slug: string; name: string }[];
  if (!role) return NextResponse.json({ error: "Unknown role" }, { status: 400 });

  // A school-side account is confined to ONE school; without one the scope
  // fails closed and the account sees nothing. Any other role acts for all
  // schools, so a school sent for it is dropped rather than quietly narrowing
  // what that person can see.
  const scoped = isSchoolScopedRole(role.slug);
  if (scoped && !body.schoolId) {
    return NextResponse.json({ error: `A ${role.name} account must be scoped to a school.` }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  try {
    const [created] = await db
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        name: body.name || null,
        passwordHash,
        role: legacyRoleFor(role.slug),
        roleId: role.id,
        schoolId: scoped ? body.schoolId : null,
        status: body.status,
      })
      .returning();
    await logActivity({
      actorId: guard.id,
      actorEmail: guard.email,
      action: "admin.user.create",
      entityType: "user",
      entityId: created.id,
      summary: `Created admin "${created.email}" as ${role.name}`,
    });
    return NextResponse.json({ user: { id: created.id } });
  } catch {
    return NextResponse.json(
      { error: "Email already in use" },
      { status: 409 }
    );
  }
}
