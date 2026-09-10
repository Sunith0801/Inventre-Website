import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { searchCustomers } from "@/server/repos/customers";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { logAdminActivity } from "@/server/activity";

export async function GET(req: Request) {
  const guard = await requirePermission("customers.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  // Scope school_admin to their own school. Fail closed if misconfigured.
  let schoolFilter: string | undefined;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    schoolFilter = guard.schoolId;
  }
  const customers = await searchCustomers(q, limit, { schoolId: schoolFilter });
  return NextResponse.json({ customers });
}

const PostBody = z.object({
  phone: z.string().min(7).max(15),
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("customers.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, PostBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const existing = await db
    .select({ id: parents.id })
    .from(parents)
    .where(eq(parents.phone, body.phone))
    .limit(1);
  if (existing.length > 0)
    return NextResponse.json(
      { error: "A customer with this phone already exists", id: existing[0].id },
      { status: 409 }
    );

  const [created] = await db
    .insert(parents)
    .values({
      phone: body.phone,
      name: body.name ?? null,
      email: body.email ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  void logAdminActivity(guard, {
    action: "customer.create",
    entityType: "customer",
    entityId: created.id,
    summary: `Created customer ${created.name ?? created.phone}`,
    req,
  });
  return NextResponse.json({ id: created.id });
}
