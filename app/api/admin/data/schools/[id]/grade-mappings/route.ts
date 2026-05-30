import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

const Row = z.object({
  grade: z.string().min(1),
  schoolGivenGradeName: z.string().nullable().optional(),
  sections: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id: schoolId } = await params;
  const body = await parseJson(req, Row);
  if (body instanceof NextResponse) return body;
  const [{ next: nextIdx }] = await db
    .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
    .from(schema.schoolGradeMappings)
    .where(eq(schema.schoolGradeMappings.schoolId, schoolId));
  const [row] = await db
    .insert(schema.schoolGradeMappings)
    .values({
      schoolId,
      rowIdx: Number(nextIdx ?? 1),
      grade: body.grade,
      schoolGivenGradeName: body.schoolGivenGradeName ?? null,
      sections: body.sections ?? null,
    })
    .returning({ id: schema.schoolGradeMappings.id });
  return NextResponse.json({ id: row.id });
}
