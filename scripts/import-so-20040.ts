/* eslint-disable no-console */
/**
 * One-shot: create the native inventre `orders` + `order_items` row for the
 * single ERPNext-native Magic Box SO SAL-ORD-2026-20040 (DITHYA G GUNJALLI,
 * SMS / St. Michael's), which was placed via the website cart in ERPNext but
 * never landed as a native inventre order.
 *
 * Reads the full SO + Address docs already pulled through the audit box into
 * scratchpad (so_20040.json, addr_20040.json).
 *
 * Unlike the batch importer this one:
 *   - links student_id (the SO customer IS enrollment 26SMS0309, parent phone
 *     matches) so it shows on the parent's My Orders under the right child;
 *   - takes grade_snapshot from the LOCAL student record (Grade 1) — ERPNext's
 *     custom_student_grade carries the +3 offset (Grade 4) and is ignored;
 *   - does NOT emit to audit. Inventre only, per instruction.
 *
 *   npx tsx --conditions=react-server scripts/import-so-20040.ts [--commit]
 *
 * Dry-run by default.
 */
import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

const COMMIT = process.argv.includes("--commit");
const SCRATCH =
  "/tmp/claude-0/-root-Inventre/5109fe21-5e59-44a6-ba5d-c67c1f452680/scratchpad";

const STATUS_MAP: Record<string, string> = {
  Draft: "placed",
  "To Pay": "placed",
  "On Hold": "placed",
  "To Deliver and Bill": "confirmed",
  "To Bill": "shipped",
  "To Deliver": "confirmed",
  Completed: "delivered",
  Cancelled: "cancelled",
  Closed: "delivered",
  Returned: "returned",
};

function financialYearOf(date: Date): string {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

const digits10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);

async function one<T = any>(q: any): Promise<T | undefined> {
  const r: any = await db.execute(q);
  return (r.rows ?? r)[0];
}

async function main() {
  const so: any = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, "so_20040.json"), "utf8")
  ).data;
  const addr: any = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, "addr_20040.json"), "utf8")
  ).data;

  const soName: string = so.name;
  const custName: string = so.customer_name ?? so.customer ?? "";
  const phone10 = digits10(so.contact_mobile);
  const rawEmail = (so.contact_email ?? "").trim().toLowerCase() || null;
  const PLACEHOLDER = /^(no|na|notavail|none|test|nil|xxx)@/;
  const email = rawEmail && !PLACEHOLDER.test(rawEmail) ? rawEmail : null;
  const boxCode: string = so.items?.[0]?.item_code;
  const subItems: any[] = Array.isArray(so.custom_sub_items)
    ? so.custom_sub_items
    : [];

  console.log(`[import-20040] ${soName}  mode=${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);

  const exists = await one(
    sql`SELECT id FROM orders WHERE order_number = ${soName} LIMIT 1`
  );
  if (exists) {
    console.log(`  SKIP — already local as order ${exists.id}`);
    process.exit(0);
  }

  // student (the SO customer). enrollment 26SMS0309.
  const student = await one(sql`
    SELECT id, name, grade, parent_id, school_id
      FROM students WHERE enrollment_number = '26SMS0309' LIMIT 1`);
  if (!student) throw new Error("student 26SMS0309 not found");

  // parent: prefer the student's own parent; fall back to phone.
  let parent = await one(
    sql`SELECT id, email FROM parents WHERE id = ${student.parent_id} LIMIT 1`
  );
  let parentAction = "student.parent";
  if (!parent) {
    parent = await one(
      sql`SELECT id, email FROM parents WHERE right(regexp_replace(phone::text,'\\D','','g'),10) = ${phone10} LIMIT 1`
    );
    parentAction = "matched(phone)";
  }
  if (!parent) throw new Error("no parent for order");

  const school = await one(sql`
    SELECT id FROM schools WHERE erp_name = ${so.custom_student_school}
    UNION ALL SELECT id FROM schools WHERE name = ${so.custom_student_school}
    LIMIT 1`);

  const box = await one(sql`
    SELECT pv.id AS variant_id, p.id AS product_id, p.name, p.hsn_code, p.kind
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE pv.sku = ${boxCode} LIMIT 1`);

  // bundle_selections from sub-items
  const bundle: any[] = [];
  const unresolved: string[] = [];
  for (const si of subItems) {
    const v = await one(sql`
      SELECT pv.id AS variant_id, pv.size, p.id AS product_id, p.name
        FROM product_variants pv JOIN products p ON p.id = pv.product_id
       WHERE pv.sku = ${si.item_code} LIMIT 1`);
    const qty = Number(si.qty) || 1;
    if (!v) {
      unresolved.push(si.item_code);
      bundle.push({
        variantId: null,
        name: si.item_code,
        size: null,
        qty,
        attributes: [],
        componentProductId: null,
        unresolvedSku: si.item_code,
      });
      continue;
    }
    bundle.push({
      variantId: v.variant_id,
      name: v.name,
      size: v.size ?? null,
      qty,
      attributes: v.size ? [{ name: "Size", value: String(v.size) }] : [],
      componentProductId: v.product_id,
    });
  }

  const placedAt = so.transaction_date; // 'YYYY-MM-DD'
  const status = STATUS_MAP[so.status] ?? "placed";
  const shippingAddress = {
    line1: addr.address_line1 ?? "—",
    line2: addr.address_line2 ?? null,
    city: addr.city ?? "—",
    state: addr.state ?? "—",
    pincode: addr.pincode ?? "000000",
    receiverName: custName || "—",
    receiverPhone: phone10 || digits10(addr.phone),
  };

  console.log(
    `  ${soName}  ${custName} | box=${boxCode}\n` +
      `    student=${student.name} (${student.grade}) parent=${parentAction} ` +
      `school=${school ? "ok" : "MISSING"} box=${
        box ? (box.kind === "magic_box" ? "ok" : `kind=${box.kind}`) : "MISSING"
      } status=${so.status}->${status}\n` +
      `    subitems: ${bundle.length - unresolved.length}/${bundle.length} resolved${
        unresolved.length ? ` (unresolved: ${unresolved.join(", ")})` : ""
      }\n` +
      `    grade_snapshot=${student.grade} (local; ERP said ${so.custom_student_grade})\n` +
      `    addr: ${shippingAddress.line1}, ${shippingAddress.city} ${shippingAddress.pincode} | ${email ?? "no-email"} | ${phone10}`
  );

  if (!box || !school) {
    console.log(`    !! cannot import — missing box/school.`);
    process.exit(1);
  }

  if (!COMMIT) {
    console.log(`\n[import-20040] dry-run, no writes.`);
    process.exit(0);
  }

  const erpRaw = {
    salesOrder: so,
    address: addr,
    fetchedAt: new Date().toISOString(),
    importedBy: "import-so-20040",
  };

  const ins = await one(sql`
    INSERT INTO orders
      (id, order_number, parent_id, student_id, school_id, status, payment_status,
       subtotal, tax, shipping, discount, total, shipping_address, grade_snapshot,
       school_name_snapshot, financial_year, tags, erp_so_name, erp_sales_order_name,
       erp_last_polled_at, erp_raw, placed_at, confirmed_at, created_at)
    VALUES
      (gen_random_uuid(), ${soName}, ${parent.id}, ${student.id}, ${school.id},
       ${status}::order_status, 'pending'::payment_status,
       0,0,0,0,0, ${JSON.stringify(shippingAddress)}::jsonb, ${student.grade},
       ${so.custom_student_school ?? null}, ${financialYearOf(new Date(placedAt))},
       ARRAY['magic_box']::text[], ${soName}, ${soName},
       now(), ${JSON.stringify(erpRaw)}::jsonb,
       ${placedAt}::timestamptz, ${status === "delivered" ? sql`${placedAt}::timestamptz` : sql`NULL`},
       ${placedAt}::timestamptz)
    ON CONFLICT (order_number) DO NOTHING
    RETURNING id`);
  if (!ins) {
    console.log(`    race: order_number already inserted; skipped.`);
    process.exit(0);
  }
  const orderId = ins.id;

  if (email && !parent.email) {
    await db.execute(
      sql`UPDATE parents SET email = ${email} WHERE id = ${parent.id} AND (email IS NULL OR email = '')`
    );
  }

  await db.execute(sql`
    INSERT INTO order_items
      (id, order_id, variant_id, name_snapshot, size, qty, unit_price, total,
       hsn_code_snapshot, gst_treatment_snapshot, bundle_selections)
    VALUES
      (gen_random_uuid(), ${orderId}, ${box.variant_id}, ${box.name}, ${boxCode},
       1, 0, 0, ${box.hsn_code ?? null}, 'nil_rated'::gst_treatment,
       ${JSON.stringify(bundle)}::jsonb)`);

  console.log(`\n[import-20040] inserted order ${orderId} + 1 box line (${bundle.length} sub-items). NO audit push.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
