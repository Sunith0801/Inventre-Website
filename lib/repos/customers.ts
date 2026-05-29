import "server-only";
import { eq, ilike, or, sql, desc, inArray, and } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, addresses, students, schools, orders } from "@/db/schema";

export type CustomerListRow = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  customerGroup: string;
  totalOrderCount: number;
  totalLifetimeValue: number; // paise
  lastOrderAt: string | null;
  studentSchools: string[];
};

export async function searchCustomers(
  query: string,
  limit = 50,
  opts: { schoolId?: string } = {}
): Promise<CustomerListRow[]> {
  const q = query.trim();
  const textWhere = q
    ? or(
        ilike(parents.name, `%${q}%`),
        ilike(parents.phone, `%${q}%`),
        ilike(parents.email, `%${q}%`)
      )
    : undefined;

  // school_admin scope: only parents who have at least one student at the school.
  let rows;
  if (opts.schoolId) {
    const scopedIds = await db
      .selectDistinct({ id: students.parentId })
      .from(students)
      .where(eq(students.schoolId, opts.schoolId));
    if (scopedIds.length === 0) return [];
    const ids = scopedIds
      .map((r) => r.id)
      .filter((id): id is string => id !== null);
    if (ids.length === 0) return [];
    rows = await db
      .select()
      .from(parents)
      .where(
        textWhere ? and(textWhere, inArray(parents.id, ids)) : inArray(parents.id, ids)
      )
      .orderBy(desc(parents.lastOrderAt))
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(parents)
      .where(textWhere)
      .orderBy(desc(parents.lastOrderAt))
      .limit(limit);
  }
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const studentRows = await db
    .select({
      parentId: students.parentId,
      schoolName: schools.name,
    })
    .from(students)
    .innerJoin(schools, eq(schools.id, students.schoolId))
    .where(inArray(students.parentId, ids));

  const schoolsByParent = new Map<string, string[]>();
  for (const s of studentRows) {
    if (!s.parentId || !s.schoolName) continue;
    const arr = schoolsByParent.get(s.parentId) ?? [];
    if (!arr.includes(s.schoolName)) arr.push(s.schoolName);
    schoolsByParent.set(s.parentId, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    customerGroup: r.customerGroup,
    totalOrderCount: r.totalOrderCount,
    totalLifetimeValue: r.totalLifetimeValue,
    lastOrderAt: r.lastOrderAt?.toISOString() ?? null,
    studentSchools: schoolsByParent.get(r.id) ?? [],
  }));
}

export async function getCustomerDetail(
  parentId: string,
  opts: { schoolId?: string } = {}
) {
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.id, parentId))
    .limit(1);
  if (!parent) return null;

  // school_admin scope: parent must have at least one student at this school.
  if (opts.schoolId) {
    const [match] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.parentId, parentId), eq(students.schoolId, opts.schoolId))
      )
      .limit(1);
    if (!match) return null;
  }

  const [studentRows, addressRows, orderRows] = await Promise.all([
    db
      .select({ s: students, school: schools })
      .from(students)
      .innerJoin(schools, eq(schools.id, students.schoolId))
      .where(eq(students.parentId, parentId)),
    db.select().from(addresses).where(eq(addresses.parentId, parentId)),
    db
      .select()
      .from(orders)
      .where(eq(orders.parentId, parentId))
      .orderBy(desc(orders.createdAt))
      .limit(20),
  ]);

  return {
    id: parent.id,
    name: parent.name,
    phone: parent.phone,
    email: parent.email,
    status: parent.status,
    customerGroup: parent.customerGroup,
    tags: parent.tags ?? [],
    notes: parent.notes,
    totalLifetimeValue: parent.totalLifetimeValue,
    totalOrderCount: parent.totalOrderCount,
    lastOrderAt: parent.lastOrderAt?.toISOString() ?? null,
    createdAt: parent.createdAt.toISOString(),
    students: studentRows.map((r) => ({
      id: r.s.id,
      name: r.s.name,
      class: r.s.class,
      section: r.s.section,
      schoolName: r.school.name,
      schoolId: r.school.id,
    })),
    addresses: addressRows.map((a) => ({
      id: a.id,
      label: a.addressTitle ?? a.label ?? null,
      addressType: a.addressType,
      receiverName: a.receiverName,
      receiverPhone: a.receiverPhone,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      country: a.country,
      gstin: a.gstin,
      isDefault: a.isDefault,
    })),
    orders: orderRows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      total: o.total,
      createdAt: o.createdAt.toISOString(),
    })),
  };
}

/** Recompute LTV + order count + last order date for a parent (call after order events). */
export async function recomputeParentStats(parentId: string): Promise<void> {
  const [stats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${orders.total}), 0)`,
      count: sql<number>`COUNT(${orders.id})`,
      last: sql<string | null>`MAX(${orders.createdAt})`,
    })
    .from(orders)
    .where(eq(orders.parentId, parentId));

  await db
    .update(parents)
    .set({
      totalLifetimeValue: Number(stats?.total ?? 0),
      totalOrderCount: Number(stats?.count ?? 0),
      lastOrderAt: stats?.last ? new Date(stats.last) : null,
    })
    .where(eq(parents.id, parentId));
}
