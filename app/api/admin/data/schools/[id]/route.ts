import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

const Patch = z.object({
  schoolCode: z.string().min(1).max(40).optional(),
  schoolName: z.string().min(1).optional(),
  branchName: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  schoolLogoUrl: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  uniformDetailsCheckbox: z.boolean().optional(),
  booksDetailsCheckbox: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;

  const update: Record<string, unknown> = { syncedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (k === "status") {
      update.status = v === "Inactive" ? "paused" : "active";
    } else {
      update[k] = v;
    }
  }
  // Keep storefront `name` in sync with `schoolName` on every write.
  if (body.schoolName !== undefined) update.name = body.schoolName;

  await db.update(schema.schools).set(update).where(eq(schema.schools.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(schema.schools).where(eq(schema.schools.id, id));
  return NextResponse.json({ ok: true });
}
