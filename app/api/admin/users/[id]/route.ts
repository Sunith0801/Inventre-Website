import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

const Body = z.object({
  email: z.string().email().optional(),
  name: z.string().nullable().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["super", "ops", "school_admin"]).optional(),
  schoolId: z.string().nullable().optional(),
  status: z.enum(["active", "blocked", "pending"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const update: Record<string, unknown> = {};
  if (body.email !== undefined) update.email = body.email.toLowerCase();
  if (body.name !== undefined) update.name = body.name || null;
  if (body.role !== undefined) update.role = body.role;
  if (body.schoolId !== undefined) update.schoolId = body.schoolId || null;
  if (body.status !== undefined) update.status = body.status;
  if (body.password) update.passwordHash = await bcrypt.hash(body.password, 10);

  await db.update(users).set(update).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  // Don't let an admin delete themselves
  if (guard.id === id)
    return NextResponse.json(
      { error: "You can't delete your own account" },
      { status: 400 }
    );
  await db.delete(users).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}
