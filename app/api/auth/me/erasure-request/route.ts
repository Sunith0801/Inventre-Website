import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { concernMessages, concerns } from "@/db/schema";
import { allocConcernNumber } from "@/server/numbering";
import { emitConcernEvent } from "@/server/erp-bridge";
import { requireParent, isResponse } from "@/server/parent-guard";

/**
 * POST /api/auth/me/erasure-request — "Request account deletion"
 * (DPDP right of erasure / consent withdrawal).
 *
 * Additive. Files a customer-care concern for the signed-in parent, exactly
 * the way the public concern portal does (same table, same CON- numbering,
 * same audit Help Desk push), tagged subType "privacy_erasure" so the
 * grievance officer can pick it out. Nothing is deleted here — the
 * deletion itself is a manual, reviewed process.
 */

export const dynamic = "force-dynamic";

const SUB_TYPE = "privacy_erasure";
const CATEGORY = "customer_care"; // the portal's catch-all bucket
const TEAM = "customer_care";
const OPEN_STATUSES = ["submitted", "in_progress", "waiting_customer", "waiting_school"];

const Body = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  let body: z.infer<typeof Body>;
  try {
    const raw = await req.text();
    body = Body.parse(raw ? JSON.parse(raw) : {});
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Duplicate guard: one open erasure request per parent.
  const [existing] = await db
    .select({ concernNumber: concerns.concernNumber })
    .from(concerns)
    .where(
      and(
        eq(concerns.parentId, me.id),
        eq(concerns.subType, SUB_TYPE),
        inArray(concerns.status, OPEN_STATUSES),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({
      ok: true,
      existing: true,
      concernNumber: existing.concernNumber ?? null,
    });
  }

  const reason = body.reason?.trim();
  const description =
    "Parent requested account deletion / consent withdrawal under DPDP." +
    (reason ? ` Reason: ${reason}` : " Reason: (not given)");
  const contactName = me.name?.trim() || me.students[0]?.guardianName || "Parent";
  const contactPhone = me.loggedInPhone ?? me.phone;

  const concernNumber = await allocConcernNumber();
  const created = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(concerns)
      .values({
        concernNumber,
        parentId: me.id,
        orderId: null,
        studentId: null,
        category: CATEGORY,
        subType: SUB_TYPE,
        description,
        details: { request: "erasure", reason: reason ?? null },
        team: TEAM,
        contactName,
        contactPhone,
        orderRef: null,
        photos: null,
        status: "submitted",
      })
      .returning();
    await tx.insert(concernMessages).values({
      concernId: c.id,
      author: "parent",
      authorName: contactName,
      body: description,
    });
    return c;
  });

  // Same best-effort push the concern portal does so the audit Help Desk
  // sees the ticket. The durable record is the local row.
  void emitConcernEvent(created.id, "concern.created");

  return NextResponse.json({ ok: true, concernNumber: created.concernNumber ?? null });
}
