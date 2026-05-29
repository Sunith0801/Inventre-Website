/**
 * ERP sales-order lookup for a student.
 *
 * Sales-order data lives in the read-only `erp` Postgres schema (loaded from
 * the upstream ERPNext-mirror dump). It is keyed by ERPNext docnames, with no
 * FKs to the Inventre app tables — the bridge is the ERP *customer* name:
 *
 *   Inventre students.enrollment_number + school_code
 *        → erp.customers.custom_enrollment_number + custom_school_code
 *        → erp.customers.erp_name  (== erp.sales_orders.customer)
 *   (fallback) Inventre students.customer_link == erp.sales_orders.customer
 *
 * Then everything fans out by erp.sales_orders.erp_name (the SO number).
 *
 * These tables are NOT in db/schema.ts (intentionally — they're an external
 * mirror), so we query them with raw SQL via db.execute().
 */
import { db } from "@/db/client";
import { sql, type SQL } from "drizzle-orm";

/** Parameterised `IN (...)` list — drizzle binds JS arrays wrong for ANY(). */
function inList(values: string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

export type ErpOrder = {
  order_no: string;
  transaction_date: string | null;
  delivery_date: string | null;
  status: string | null;
  payment_status: string | null;
  payment_mode: string | null;
  grand_total: number | null;
  paid_amount: number | null;
  grade: string | null;
  school: string | null;
};
export type ErpItem = {
  order_no: string;
  item_code: string | null;
  item_name: string | null;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  delivered_qty: number | null;
  returned_qty: number | null;
};
export type ErpShipment = {
  order_no: string;
  partner: string | null;
  tracking_number: string | null;
  status: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  city: string | null;
  pincode: string | null;
};
export type ErpPayment = {
  order_no: string;
  due_date: string | null;
  payment_amount: number | null;
  paid_amount: number | null;
  outstanding: number | null;
};

export type StudentSalesData = {
  customerNames: string[];
  orders: ErpOrder[];
  itemsByOrder: Map<string, ErpItem[]>;
  shipmentsByOrder: Map<string, ErpShipment[]>;
  paymentsByOrder: Map<string, ErpPayment[]>;
  totals: { orderCount: number; lifetimeValue: number };
};

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
}

/** Whether the erp schema is present (dump loaded). */
export async function erpSchemaReady(): Promise<boolean> {
  const r = rows<{ ok: boolean }>(
    await db.execute(
      sql`SELECT to_regclass('erp.sales_orders') IS NOT NULL AS ok`
    )
  );
  return r[0]?.ok === true;
}

/** Resolve the ERP customer name(s) this student maps to. */
export async function resolveErpCustomerNames(student: {
  enrollmentNumber: string | null;
  schoolCode: string | null;
  customerLink: string | null;
}): Promise<string[]> {
  const names = new Set<string>();
  if (student.customerLink && student.customerLink.trim())
    names.add(student.customerLink.trim());

  if (student.enrollmentNumber && student.schoolCode) {
    const r = rows<{ erp_name: string }>(
      await db.execute(sql`
        SELECT erp_name FROM erp.customers
        WHERE custom_enrollment_number = ${student.enrollmentNumber}
          AND custom_school_code = ${student.schoolCode}
        LIMIT 10
      `)
    );
    for (const x of r) if (x.erp_name) names.add(x.erp_name);
  } else if (student.enrollmentNumber) {
    const r = rows<{ erp_name: string }>(
      await db.execute(sql`
        SELECT erp_name FROM erp.customers
        WHERE custom_enrollment_number = ${student.enrollmentNumber}
        LIMIT 10
      `)
    );
    for (const x of r) if (x.erp_name) names.add(x.erp_name);
  }
  return [...names];
}

/** Lightweight order count (for the tab label). */
export async function countStudentSalesOrders(student: {
  enrollmentNumber: string | null;
  schoolCode: string | null;
  customerLink: string | null;
}): Promise<number> {
  const names = await resolveErpCustomerNames(student);
  if (names.length === 0) return 0;
  const r = rows<{ n: number }>(
    await db.execute(
      sql`SELECT count(*)::int AS n FROM erp.sales_orders WHERE customer IN (${inList(names)})`
    )
  );
  return r[0]?.n ?? 0;
}

/** Full sales-order history + items + tracking + payments for a student. */
export async function loadStudentSalesOrders(student: {
  enrollmentNumber: string | null;
  schoolCode: string | null;
  customerLink: string | null;
}): Promise<StudentSalesData> {
  const customerNames = await resolveErpCustomerNames(student);
  const empty: StudentSalesData = {
    customerNames,
    orders: [],
    itemsByOrder: new Map(),
    shipmentsByOrder: new Map(),
    paymentsByOrder: new Map(),
    totals: { orderCount: 0, lifetimeValue: 0 },
  };
  if (customerNames.length === 0) return empty;

  const orders = rows<ErpOrder>(
    await db.execute(sql`
      SELECT erp_name                         AS order_no,
             transaction_date::text           AS transaction_date,
             delivery_date::text              AS delivery_date,
             custom_display_status            AS status,
             custom_payment_status            AS payment_status,
             custom_payment_mode              AS payment_mode,
             round(grand_total::numeric, 2)::float8        AS grand_total,
             round(coalesce(custom_paid_amount,0)::numeric,2)::float8 AS paid_amount,
             custom_student_grade             AS grade,
             custom_student_school            AS school
      FROM erp.sales_orders
      WHERE customer IN (${inList(customerNames)})
      ORDER BY transaction_date DESC NULLS LAST, erp_name DESC
    `)
  );
  if (orders.length === 0) return { ...empty, orders };

  const orderNos = orders.map((o) => o.order_no);

  const [items, shipments, payments] = await Promise.all([
    db.execute(sql`
      SELECT order_erp_name AS order_no, item_code, item_name,
             qty::float8, rate::float8, amount::float8,
             delivered_qty::float8, returned_qty::float8
      FROM erp.sales_order_items
      WHERE order_erp_name IN (${inList(orderNos)})
      ORDER BY order_erp_name, id
    `),
    db.execute(sql`
      SELECT order_erp_name AS order_no, partner, tracking_number, status,
             dispatched_at::text AS dispatched_at, delivered_at::text AS delivered_at,
             city, pincode
      FROM erp.outward_shipments
      WHERE order_erp_name IN (${inList(orderNos)})
      ORDER BY order_erp_name, id
    `),
    db.execute(sql`
      SELECT order_erp_name AS order_no, due_date::text AS due_date,
             payment_amount::float8, paid_amount::float8, outstanding::float8
      FROM erp.sales_order_payment_schedule
      WHERE order_erp_name IN (${inList(orderNos)})
      ORDER BY order_erp_name, due_date
    `),
  ]);

  const itemsByOrder = groupBy(rows<ErpItem>(items), (x) => x.order_no);
  const shipmentsByOrder = groupBy(rows<ErpShipment>(shipments), (x) => x.order_no);
  const paymentsByOrder = groupBy(rows<ErpPayment>(payments), (x) => x.order_no);

  return {
    customerNames,
    orders,
    itemsByOrder,
    shipmentsByOrder,
    paymentsByOrder,
    totals: {
      orderCount: orders.length,
      lifetimeValue: orders.reduce((s, o) => s + (o.grand_total ?? 0), 0),
    },
  };
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    const a = m.get(k);
    if (a) a.push(x);
    else m.set(k, [x]);
  }
  return m;
}
