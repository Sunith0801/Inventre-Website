import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

const Body = z.object({
  gradeName: z.string().min(1),
  gradeCode: z.string().nullable().optional(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  const [created] = await db
    .insert(schema.grades)
    .values({
      gradeName: body.gradeName,
      gradeCode: body.gradeCode ?? null,
      status: body.status,
    })
    .returning({ id: schema.grades.id });
  return NextResponse.json({ id: created.id });
}
