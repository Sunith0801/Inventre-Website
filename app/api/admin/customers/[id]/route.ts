import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { getCustomerDetail } from "@/lib/repos/customers";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("customers.read");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  let scopeSchool: string | undefined;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    scopeSchool = guard.schoolId;
  }
  const detail = await getCustomerDetail(id, { schoolId: scopeSchool });
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ customer: detail });
}

const PatchBody = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  status: z.enum(["active", "blocked", "pending"]).optional(),
  customerGroup: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("customers.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, PatchBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) update[k] = v;
  }
  await db.update(parents).set(update).where(eq(parents.id, id));
  return NextResponse.json({ ok: true });
}
