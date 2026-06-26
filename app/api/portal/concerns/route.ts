import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { concerns, concernMessages, orders, parents } from "@/db/schema";
import { allocConcernNumber } from "@/lib/numbering";
import { emitConcernEvent } from "@/lib/erp-bridge";

/**
 * PUBLIC Parent Concern intake (inventre.in/portal) — no login.
 *
 * A parent scans the QR, picks a category, types their name + phone + the
 * issue, and submits. We mint a CON- ticket, store it (best-effort linking
 * to their parent/order by the phone/order-no they typed), open a message
 * thread, and push to the Audit call-centre. Returns the ticket number.
 *
 * Public is safe here because it only WRITES a concern the submitter
 * authored — it never reveals anyone's data. Tracking (GET) is by ticket
 * number only (the reference the submitter received), not by phone, so no
 * one can enumerate another parent's concerns.
 */

export const dynamic = "force-dynamic";

const Body = z.object({
  category: z.enum([
    "payment",
    "order_delivery",
    "customer_care",
    "student_details",
    "login",
    "size_exchange",
  ]),
  name: z.string().trim().min(1, "Please enter your name").max(120),
  phone: z.string().trim().min(6, "Please enter your mobile number").max(20),
  description: z.string().trim().min(1, "Please describe the issue").max(4000),
  orderRef: z.string().trim().max(64).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const last10 = body.phone.replace(/\D/g, "").slice(-10);

  // Best-effort link to a known parent by the phone they typed (so the
  // support team sees the linked account); null is fine for a guest.
  let parentId: string | null = null;
  if (last10.length === 10) {
    const [p] = await db
      .select({ id: parents.id })
      .from(parents)
      .where(sql`right(regexp_replace(${parents.phone}, '\\D', '', 'g'), 10) = ${last10}`)
      .limit(1);
    parentId = p?.id ?? null;
  }

  // Best-effort link to a local order by the order number they typed.
  let orderId: string | null = null;
  if (body.orderRef) {
    const [o] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, body.orderRef.trim()))
      .limit(1);
    orderId = o?.id ?? null;
  }

  const concernNumber = await allocConcernNumber();
  const created = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(concerns)
      .values({
        concernNumber,
        parentId,
        orderId,
        category: body.category,
        description: body.description,
        contactName: body.name,
        contactPhone: body.phone,
        orderRef: body.orderRef ?? null,
        status: "open",
      })
      .returning();
    await tx.insert(concernMessages).values({
      concernId: c.id,
      author: "parent",
      authorName: body.name,
      body: body.description,
    });
    return c;
  });

  void emitConcernEvent(created.id, "concern.created");

  return NextResponse.json({ ok: true, id: created.id, concernNumber });
}

/** PUBLIC track-by-ticket: GET /api/portal/concerns?ref=CON-2026-00001 */
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref")?.trim();
  if (!ref) {
    return NextResponse.json({ error: "Provide a ticket number (?ref=)" }, { status: 400 });
  }
  const [c] = await db
    .select({
      id: concerns.id,
      concernNumber: concerns.concernNumber,
      category: concerns.category,
      status: concerns.status,
      description: concerns.description,
      createdAt: concerns.createdAt,
    })
    .from(concerns)
    .where(eq(concerns.concernNumber, ref))
    .limit(1);
  if (!c) return NextResponse.json({ error: "No ticket found" }, { status: 404 });

  const msgs = await db
    .select({
      author: concernMessages.author,
      authorName: concernMessages.authorName,
      body: concernMessages.body,
      createdAt: concernMessages.createdAt,
    })
    .from(concernMessages)
    .where(eq(concernMessages.concernId, c.id))
    .orderBy(asc(concernMessages.createdAt));

  return NextResponse.json({
    concern: {
      concernNumber: c.concernNumber,
      category: c.category,
      status: c.status,
      description: c.description,
      createdAt: c.createdAt.toISOString(),
    },
    // Only parent + agent messages are surfaced publicly (skip internal 'system').
    messages: msgs
      .filter((m) => m.author !== "system")
      .map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  });
}
