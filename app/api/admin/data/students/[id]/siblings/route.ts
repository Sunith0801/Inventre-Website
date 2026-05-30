import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

const Row = z.object({
  fullName: z.string().min(1),
  gender: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id: studentId } = await params;
  const body = await parseJson(req, Row);
  if (body instanceof NextResponse) return body;
  const [{ next: nextIdx }] = await db
    .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
    .from(schema.studentSiblings)
    .where(eq(schema.studentSiblings.studentId, studentId));
  const [row] = await db
    .insert(schema.studentSiblings)
    .values({
      studentId,
      rowIdx: Number(nextIdx ?? 1),
      fullName: body.fullName,
      gender: body.gender ?? null,
      grade: body.grade ?? null,
      section: body.section ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
    })
    .returning({ id: schema.studentSiblings.id });
  return NextResponse.json({ id: row.id });
}
