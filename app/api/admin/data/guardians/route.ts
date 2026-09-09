import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { parseJson } from "@/lib/api-handler";
import { phone10Schema, phone10NullableSchema } from "@/lib/phone";

const Body = z.object({
  guardianName: z.string().min(1),
  emailAddress: z.string().nullable().optional(),
  // Strips non-digits and enforces 10-digit format — admins can paste any
  // format ("+91 98765-43210", "98765 43210") and it lands as "9876543210".
  mobileNumber: phone10Schema,
  email: z.string().nullable().optional(),
  alternateNumber: phone10NullableSchema,
  dateOfBirth: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("guardians.write");
  if (isResponse(guard)) return guard;
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  const [created] = await db
    .insert(schema.guardians)
    .values({
      guardianName: body.guardianName,
      emailAddress: body.emailAddress ?? null,
      mobileNumber: body.mobileNumber,
      email: body.email ?? null,
      alternateNumber: body.alternateNumber ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
    })
    .returning({ id: schema.guardians.id });

  void logAdminActivity(guard, {
    action: "guardian.create",
    entityType: "guardian",
    entityId: created.id,
    summary: `Created guardian ${body.guardianName}`,
    req,
  });

  return NextResponse.json({ id: created.id });
}
