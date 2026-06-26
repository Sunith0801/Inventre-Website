import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, schools, parents } from "@/db/schema";
import {
  listParentOrdersFromErp,
  getParentOrderDetailFromErp,
} from "@/lib/erp-customer-orders";

/**
 * PUBLIC search for the Parent Support Portal — by Student ID (enrollment)
 * or Mobile Number. Returns the family's student(s) + all orders + status +
 * tracking on the latest. Open per product decision (no verification).
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "Enter a Student ID or mobile number" }, { status: 400 });

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
    parent: { name: parent?.name ?? null, mobile: parent?.phone ?? null },
    students: kidRows.map((k) => ({
      ...k,
      guardianName: parent?.name ?? null,
      guardianMobile: parent?.phone ?? null,
    })),
    orders,
  });
}
