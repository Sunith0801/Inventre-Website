import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";

const Body = z.object({
  email: z.string().email().optional(),
  name: z.string().nullable().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["super", "ops", "school_admin"]).optional(),
  /** Optional override: assign any role (system or custom) by id. Takes
   *  precedence over `role` enum mapping when both are present. */
  roleId: z.string().uuid().optional(),
  schoolId: z.string().nullable().optional(),
  status: z.enum(["active", "blocked", "pending"]).optional(),
});

/** Reverse-map an admin_roles row to the legacy users.role enum so the
 *  ~310 unmigrated `requireAdmin(role)` callsites keep working. */
async function enumForRoleId(
  roleId: string,
): Promise<"super" | "ops" | "school_admin" | null> {
  const [row] = (await db.execute(
    sql`SELECT slug FROM admin_roles WHERE id = ${roleId} LIMIT 1`,
  )) as unknown as { slug: string }[];
  if (!row) return null;
  if (row.slug === "super-admin") return "super";
  if (row.slug === "operations") return "ops";
  if (row.slug === "school-admin") return "school_admin";
  // Custom role — pick the closest legacy enum so requireAdmin gates don't
  // wholesale 403. Custom roles get "ops" treatment (mid-power); their
  // actual access is governed by admin_role_permissions + overrides.
  return "ops";
}

/** Map legacy enum value to the canonical admin_roles row id. */
async function roleIdForEnum(role: "super" | "ops" | "school_admin"): Promise<string | null> {
  const slug = role === "super" ? "super-admin" : role === "ops" ? "operations" : "school-admin";
  const [row] = (await db.execute(sql`SELECT id FROM admin_roles WHERE slug = ${slug} LIMIT 1`)) as unknown as { id: string }[];
  return row?.id ?? null;
}

/** Count remaining super-admins after removing this user from the set. */
async function countOtherActiveSupers(excludeId: string): Promise<number> {
  const [{ n }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM users WHERE role = 'super' AND status = 'active' AND id != ${excludeId}
  `)) as unknown as { n: number }[];
  return n;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-users.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Self-edit guards. Admin can edit their own name / password / email but not
  // role, schoolId, or status — that's how an admin would lock themselves out.
  if (guard.id === id) {
    if (body.role !== undefined && body.role !== target.role) {
      return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    }
    if (body.roleId !== undefined && body.roleId !== target.roleId) {
      return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    }
    if (body.status !== undefined && body.status !== "active") {
      return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
    }
  }

  // Last-super-admin guard. Refuse any change that would drop the active-super
  // count to zero (demote / block / change another super to non-super).
  const wouldStopBeingSuper =
    (body.role !== undefined && body.role !== "super") ||
    (body.status !== undefined && body.status !== "active");
  if (target.role === "super" && wouldStopBeingSuper) {
    const others = await countOtherActiveSupers(id);
    if (others === 0) {
      return NextResponse.json({ error: "Refusing — at least one active Super Admin must remain." }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = {};
  if (body.email !== undefined) update.email = body.email.toLowerCase();
  if (body.name !== undefined) update.name = body.name || null;
  // roleId takes precedence — it lets super-admin assign custom roles. The
  // legacy enum is mirrored from the picked role so unmigrated
  // requireAdmin(role) callsites keep enforcing something sensible.
  if (body.roleId !== undefined) {
    const mappedEnum = await enumForRoleId(body.roleId);
    if (!mappedEnum) {
      return NextResponse.json({ error: "Unknown roleId" }, { status: 400 });
    }
    update.roleId = body.roleId;
    update.role = mappedEnum;
  } else if (body.role !== undefined) {
    update.role = body.role;
    update.roleId = await roleIdForEnum(body.role);
  }
  if (body.schoolId !== undefined) update.schoolId = body.schoolId || null;
  if (body.status !== undefined) update.status = body.status;
  if (body.password) update.passwordHash = await bcrypt.hash(body.password, 10);

  await db.update(users).set(update).where(eq(users.id, id));

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "admin.user.update",
    entityType: "user",
    entityId: id,
    summary: `Updated admin "${target.email}"`,
    diff: {
      email: body.email,
      role: body.role,
      schoolId: body.schoolId,
      status: body.status,
      passwordReset: body.password ? true : undefined,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-users.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  if (guard.id === id)
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (target.role === "super") {
    const others = await countOtherActiveSupers(id);
    if (others === 0) {
      return NextResponse.json({ error: "Refusing — at least one active Super Admin must remain." }, { status: 400 });
    }
  }

  await db.delete(users).where(eq(users.id, id));

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "admin.user.delete",
    entityType: "user",
    entityId: id,
    summary: `Deleted admin "${target.email}"`,
  });

  return NextResponse.json({ ok: true });
}
