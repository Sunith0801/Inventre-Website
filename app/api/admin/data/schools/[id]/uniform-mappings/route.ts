import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { logAdminActivity } from "@/lib/activity";

const Row = z.object({
  grade: z.string().min(1),
  organisationGivenGrade: z.string().nullable().optional(),
  sections: z.string().nullable().optional(),
  organisationGivenSection: z.string().nullable().optional(),
  houseName: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id: schoolId } = await params;
  const body = await parseJson(req, Row);
  if (body instanceof NextResponse) return body;
  const [{ next: nextIdx }] = await db
    .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
    .from(schema.schoolUniformMappings)
    .where(eq(schema.schoolUniformMappings.schoolId, schoolId));
  const [row] = await db
    .insert(schema.schoolUniformMappings)
    .values({
      schoolId,
      rowIdx: Number(nextIdx ?? 1),
      grade: body.grade,
      organisationGivenGrade: body.organisationGivenGrade ?? null,
      sections: body.sections ?? null,
      organisationGivenSection: body.organisationGivenSection ?? null,
      houseName: body.houseName ?? null,
    })
    .returning({ id: schema.schoolUniformMappings.id });
  void logAdminActivity(guard, {
    action: "school.uniform_mapping.add",
    entityType: "school",
    entityId: schoolId,
    summary: `Added uniform mapping ${body.grade}${body.houseName ? ` · ${body.houseName}` : ""}`,
    req,
  });
  return NextResponse.json({ id: row.id });
}
