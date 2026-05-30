import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";

const Body = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  password: z.string().min(6),
  role: z.enum(["super", "ops", "school_admin"]),
  schoolId: z.string().nullable().optional(),
  status: z.enum(["active", "blocked", "pending"]).default("active"),
});

async function roleIdForEnum(role: "super" | "ops" | "school_admin"): Promise<string | null> {
  const slug = role === "super" ? "super-admin" : role === "ops" ? "operations" : "school-admin";
  const [row] = (await db.execute(sql`SELECT id FROM admin_roles WHERE slug = ${slug} LIMIT 1`)) as unknown as { id: string }[];
  return row?.id ?? null;
}

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  try {
    const [created] = await db
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        name: body.name || null,
        passwordHash,
        role: body.role,
        roleId: await roleIdForEnum(body.role),
        schoolId: body.schoolId || null,
        status: body.status,
      })
      .returning();
    await logActivity({
      actorId: guard.id,
      actorEmail: guard.email,
      action: "admin.user.create",
      entityType: "user",
      entityId: created.id,
      summary: `Created admin "${created.email}" as ${body.role}`,
    });
    return NextResponse.json({ user: { id: created.id } });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Email already in use" },
      { status: 409 }
    );
  }
}
