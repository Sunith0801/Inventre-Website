import { NextResponse } from "next/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, schools, parents, concerns } from "@/db/schema";

/** `******1234` unless the query itself was that number. */
function safeMobile(phone: string | null | undefined, query: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const qd = query.replace(/\D/g, "");
  if (qd.length >= 10 && digits.slice(-10) === qd.slice(-10)) return phone;
  return `******${digits.slice(-4)}`;
}
import {
  listParentOrdersFromErp,
  getParentOrderDetailFromErp,
} from "@/server/erp-customer-orders";
import { rateLimit } from "@/server/rate-limit";
import { issuePortalTicket } from "@/server/portal-ticket";

/**
 * PUBLIC search for the Parent Support Portal — by Student ID (enrollment)
 * or Mobile Number. Returns the family's student(s) + all orders + status +
 * tracking on the latest. Open per product decision (no verification).
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "Enter a Student ID or mobile number" }, { status: 400 });

  // P-16: a public lookup of families by number needs a ceiling per caller.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const rl = await rateLimit({ key: `portal:search:${ip}`, max: 60, windowSeconds: 600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many searches. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const digits = q.replace(/\D/g, "");
  let parentId: string | null = null;

  if (digits.length >= 10) {
    // Mobile path.
    const last10 = digits.slice(-10);
    const [p] = await db
      .select({ id: parents.id })
      .from(parents)
      .where(sql`right(regexp_replace(${parents.phone}, '\\D', '', 'g'), 10) = ${last10}`)
      .limit(1);
    parentId = p?.id ?? null;
  }
  if (!parentId) {
    // Student ID (enrollment) path — also a fallback if the mobile had no parent.
    const [s] = await db
      .select({ parentId: students.parentId })
      .from(students)
      .where(sql`lower(${students.enrollmentNumber}) = lower(${q})`)
      .limit(1);
    parentId = s?.parentId ?? null;
  }

  if (!parentId) return NextResponse.json({ found: false });

  const [parent] = await db
    .select({ name: parents.name, phone: parents.phone })
    .from(parents)
    .where(eq(parents.id, parentId))
    .limit(1);

  const kidRows = await db
    .select({
      id: students.id,
      name: students.name,
      enrollment: students.enrollmentNumber,
      grade: students.grade,
      gender: students.gender,
      school: schools.name,
    })
    .from(students)
    .leftJoin(schools, eq(schools.id, students.schoolId))
    .where(eq(students.parentId, parentId));

  // My Concerns — every concern raised by this parent OR for any of their kids.
  const kidIds = kidRows.map((k) => k.id);
  const concernScope = kidIds.length
    ? or(eq(concerns.parentId, parentId), inArray(concerns.studentId, kidIds))
    : eq(concerns.parentId, parentId);
  const concernRows = await db
    .select({
      concernNumber: concerns.concernNumber,
      category: concerns.category,
      subType: concerns.subType,
      status: concerns.status,
      orderRef: concerns.orderRef,
      studentId: concerns.studentId,
      createdAt: concerns.createdAt,
      updatedAt: concerns.updatedAt,
    })
    .from(concerns)
    .where(and(concernScope, sql`${concerns.concernNumber} is not null`))
    .orderBy(desc(concerns.createdAt));

  let orders: {
    orderNumber: string;
    status: string;
    orderedDate: string;
    studentName: string | null;
    carrier: string | null;
    tracking: string | null;
  }[] = [];
  try {
    const list = await listParentOrdersFromErp(parentId);
    orders = list.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      orderedDate: o.createdAt,
      studentName: o.studentName,
      carrier: null,
      tracking: null,
    }));
    // Enrich the most recent order with carrier/tracking + authoritative status.
    if (orders[0]) {
      const detail = await getParentOrderDetailFromErp(parentId, orders[0].orderNumber);
      const ship = detail?.tracking?.find((t) => t.trackingNumber) ?? detail?.tracking?.[0];
      if (ship) {
        orders[0].carrier = ship.partner ?? null;
        orders[0].tracking = ship.trackingNumber ?? null;
      }
      if (detail?.status) orders[0].status = detail.status;
    }
  } catch {
    // best-effort
  }

  return NextResponse.json({
    found: true,
    parentId,
    // P-16: lets THIS visitor attach photos to a concern for the next 30 min.
    uploadTicket: await issuePortalTicket(parentId),
    // Public, no-login endpoint: only echo the full mobile back to someone
    // who searched BY that mobile (they already know it). A Student-ID
    // search gets a masked number (Data Protection P-05).
    parent: { name: parent?.name ?? null, mobile: safeMobile(parent?.phone, q) },
    students: kidRows.map((k) => ({
      ...k,
      guardianName: parent?.name ?? null,
      guardianMobile: safeMobile(parent?.phone, q),
    })),
    orders,
    concerns: concernRows.map((c) => ({
      concernNumber: c.concernNumber,
      category: c.category,
      subType: c.subType,
      status: c.status,
      orderRef: c.orderRef,
      studentId: c.studentId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  });
}
