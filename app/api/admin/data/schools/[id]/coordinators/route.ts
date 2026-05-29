import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

const Row = z.object({
  pocName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactNumber: z.string().nullable().optional(),
  alternateNumber: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { id: schoolId } = await params;
  const body = await parseJson(req, Row);
  if (body instanceof NextResponse) return body;
  const [{ next: nextIdx }] = await db
    .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
    .from(schema.schoolCoordinators)
    .where(eq(schema.schoolCoordinators.schoolId, schoolId));
  const [row] = await db
    .insert(schema.schoolCoordinators)
    .values({
      schoolId,
      rowIdx: Number(nextIdx ?? 1),
      pocName: body.pocName ?? null,
      email: body.email ?? null,
      contactNumber: body.contactNumber ?? null,
      alternateNumber: body.alternateNumber ?? null,
      role: body.role ?? null,
    })
    .returning({ id: schema.schoolCoordinators.id });
  return NextResponse.json({ id: row.id });
}
