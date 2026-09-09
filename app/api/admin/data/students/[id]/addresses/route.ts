import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { parseJson } from "@/lib/api-handler";
import { emitAddressEvent } from "@/lib/erp-bridge";

const Row = z.object({
  kind: z.enum(["billing", "shipping"]),
  addressType: z.string().nullable().optional(),
  addressTitle: z.string().nullable().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  preferred: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id: studentId } = await params;
  const body = await parseJson(req, Row);
  if (body instanceof NextResponse) return body;
  const [{ next: nextIdx }] = await db
    .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
    .from(schema.studentAddresses)
    .where(and(eq(schema.studentAddresses.studentId, studentId), eq(schema.studentAddresses.kind, body.kind)));
  const [row] = await db
    .insert(schema.studentAddresses)
    .values({
      studentId,
      kind: body.kind,
      rowIdx: Number(nextIdx ?? 1),
      addressType: body.addressType ?? null,
      addressTitle: body.addressTitle ?? null,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      country: body.country ?? null,
      pincode: body.pincode ?? null,
      preferred: body.preferred ?? false,
      disabled: body.disabled ?? false,
    })
    .returning({ id: schema.studentAddresses.id });
  void emitAddressEvent(row.id);

  void logAdminActivity(guard, {
    action: "student.address.add",
    entityType: "student",
    entityId: studentId,
    summary: `Added ${body.kind} address ${[body.addressLine1, body.city].filter(Boolean).join(", ")}`,
    req,
  });

  return NextResponse.json({ id: row.id });
}
