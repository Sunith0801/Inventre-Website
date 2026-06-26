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
 * Captures the dynamic per-category form (details jsonb), routes to the right
 * team, mints a CON- ticket, opens a message thread, and pushes to audit.
 * Tracking (GET ?ref=) is by ticket number only.
 */

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "login",
  "grade_change",
  "student_details",
  "school_details",
  "guardian",
  "order_delivery",
  "payment",
  "customer_care",
] as const;

// Which teams a category routes to in the audit dashboard.
const TEAM_BY_CATEGORY: Record<string, string> = {
  order_delivery: "customer_care,sales",
  payment: "customer_care",
  customer_care: "customer_care",
  login: "customer_care",
  grade_change: "customer_care",
  student_details: "customer_care",
  school_details: "customer_care",
  guardian: "customer_care",
};
const PHOTO_REQUIRED = new Set(["grade_change", "payment"]);

const Photo = z.object({ url: z.string(), key: z.string() });
const Body = z.object({
  category: z.enum(CATEGORIES),
  subType: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1, "Please enter your name").max(120),
  phone: z.string().trim().min(6, "Please enter your mobile number").max(20),
  description: z.string().trim().max(4000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  photos: z.array(Photo).max(6).optional(),
  studentId: z.string().uuid().optional(),
  orderRef: z.string().trim().max(64).optional(),
});

/** Build a readable summary when the form didn't send a description. */
function summarize(category: string, details: Record<string, unknown> | undefined): string {
  if (!details) return "";
  const pairs = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`);
  return pairs.join("\n");
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (PHOTO_REQUIRED.has(body.category) && (!body.photos || body.photos.length === 0)) {
    return NextResponse.json({ error: "A photo is required for this request." }, { status: 400 });
  }

  const description = (body.description?.trim() || summarize(body.category, body.details)).trim();
  if (!description) {
    return NextResponse.json({ error: "Please describe the issue." }, { status: 400 });
  }

  const last10 = body.phone.replace(/\D/g, "").slice(-10);
  let parentId: string | null = null;
  if (last10.length === 10) {
    const [p] = await db
      .select({ id: parents.id })
      .from(parents)
      .where(sql`right(regexp_replace(${parents.phone}, '\\D', '', 'g'), 10) = ${last10}`)
      .limit(1);
    parentId = p?.id ?? null;
  }

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
        studentId: body.studentId ?? null,
        category: body.category,
        subType: body.subType ?? null,
        description,
        details: body.details ?? null,
        team: TEAM_BY_CATEGORY[body.category] ?? "customer_care",
        contactName: body.name,
        contactPhone: body.phone,
        orderRef: body.orderRef ?? null,
        photos: body.photos ?? null,
        status: "submitted",
      })
      .returning();
    await tx.insert(concernMessages).values({
      concernId: c.id,
      author: "parent",
      authorName: body.name,
      body: description,
    });
    return c;
  });

  void emitConcernEvent(created.id, "concern.created");

  return NextResponse.json({ ok: true, id: created.id, concernNumber });
}

/** PUBLIC track-by-ticket: GET /api/portal/concerns?ref=CON-2026-00001 */
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref")?.trim();
  if (!ref) return NextResponse.json({ error: "Provide a ticket number (?ref=)" }, { status: 400 });

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
    messages: msgs
      .filter((m) => m.author !== "system")
      .map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  });
}
