import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

const Body = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  password: z.string().min(6),
  role: z.enum(["super", "ops", "school_admin"]),
  schoolId: z.string().nullable().optional(),
  status: z.enum(["active", "blocked", "pending"]).default("active"),
});

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
        schoolId: body.schoolId || null,
        status: body.status,
      })
      .returning();
    return NextResponse.json({ user: { id: created.id } });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Email already in use" },
      { status: 409 }
    );
  }
}
