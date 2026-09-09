/* eslint-disable no-console */
/**
 * Restore a magic-box order that was over-deleted by the SMS dedup, from the
 * FULL archived outbound payload in webhook_deliveries (the last push that
 * still carried sub_items). Recreates the native inventre orders + order_items
 * (reusing the original UUID + student/parent link) and re-emits order.created
 * to audit.
 *
 *   npx tsx --conditions=react-server scripts/restore-erp-order.ts <ORDER_NUMBER> [--commit]
 *
 * Dry-run by default: resolves everything and prints what it would insert.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitOrderEvent } from "@/lib/erp-bridge";

const ORDER_NUMBER = process.argv[2];
const COMMIT = process.argv.includes("--commit");

async function main() {
  if (!ORDER_NUMBER) { console.error("usage: restore-erp-order.ts <ORDER_NUMBER> [--commit]"); process.exit(1); }

  // 1. Best archived payload (max sub_items) for this order.
  const pr: any = await db.execute(sql`
    SELECT payload->'data'->'order' AS o
    FROM webhook_deliveries
    WHERE event LIKE 'order%' AND payload->'data'->'order'->>'order_number' = ${ORDER_NUMBER}
    ORDER BY jsonb_array_length(coalesce(payload->'data'->'order'->'sub_items','[]'::jsonb)) DESC,
             created_at DESC
    LIMIT 1`);
  const o = pr.rows?.[0]?.o ?? pr[0]?.o;
  if (!o) throw new Error(`no archived payload for ${ORDER_NUMBER}`);

  const orderId: string = o.id;
  const enr: string = o.student?.enrollment_number;
  const mobile10 = String(o.customer?.mobile ?? "").replace(/\D/g, "").slice(-10);
  const boxCode: string = o.items?.[0]?.item_code;
  const subItems: any[] = Array.isArray(o.sub_items) ? o.sub_items : [];

  // 2. Resolve fks.
  const one = async (q: any) => { const r: any = await db.execute(q); return (r.rows ?? r)[0]; };
  const student = await one(sql`SELECT id, school_id FROM students WHERE enrollment_number = ${enr} LIMIT 1`);
  const parent = await one(sql`SELECT id FROM parents WHERE right(regexp_replace(phone::text,'\\D','','g'),10) = ${mobile10} LIMIT 1`);
  const box = await one(sql`SELECT pv.id, p.name FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.sku = ${boxCode} LIMIT 1`);
  if (!student) throw new Error(`student not resolved for enrollment ${enr}`);
  if (!parent) throw new Error(`parent not resolved for mobile ${mobile10}`);
  if (!box) throw new Error(`box variant not resolved for ${boxCode}`);

  // 3. bundle_selections from sub_items (resolve each SKU -> variant UUID).
  const bundle: any[] = [];
  const unresolved: string[] = [];
  for (const si of subItems) {
    const v = await one(sql`SELECT pv.id, p.name FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.sku = ${si.item_code} LIMIT 1`);
    if (!v) { unresolved.push(si.item_code); continue; }
    const size = si.size ?? null;
    bundle.push({
      variantId: v.id, name: v.name, size, qty: Number(si.qty) || 1,
      attributes: size ? [{ name: "Size", value: String(size) }] : [],
    });
  }
  if (unresolved.length) throw new Error(`unresolved sub-item SKUs: ${unresolved.join(", ")}`);

  const a = o.shipping_address ?? {};
  const shipping = {
    city: a.city ?? null, line1: a.line1 ?? null, line2: a.line2 ?? null,
    state: a.state ?? null, pincode: a.pincode ?? null,
    receiverName: a.receiver_name ?? null, receiverPhone: a.receiver_phone ?? null,
  };

  console.log(JSON.stringify({
    orderId, order_number: ORDER_NUMBER, student_id: student.id, parent_id: parent.id,
    school_id: student.school_id, box_variant: box.id, box_name: box.name,
    status: o.status, payment_status: o.payment_status, grade: o.grade,
    bundle_count: bundle.length, sizes: bundle.map((b) => `${b.name} ${b.size} x${b.qty}`),
  }, null, 2));

  if (!COMMIT) { console.log("\n[dry-run] no writes. add --commit to apply."); process.exit(0); }

  // 4. Insert orders + order_items (idempotent on order id).
  await db.execute(sql`
    INSERT INTO orders (id, order_number, parent_id, student_id, school_id, status, payment_status,
                        subtotal, tax, shipping, discount, total, shipping_address, grade_snapshot,
                        school_name_snapshot, erp_so_name, erp_sales_order_name, placed_at, created_at)
    VALUES (${orderId}, ${ORDER_NUMBER}, ${parent.id}, ${student.id}, ${student.school_id},
            ${o.status}::order_status, ${o.payment_status}::payment_status,
            0,0,0,0,0, ${JSON.stringify(shipping)}::jsonb, ${o.grade ?? null},
            ${o.school_name ?? null}, ${ORDER_NUMBER}, ${ORDER_NUMBER}, '2026-06-15'::timestamptz, '2026-06-15'::timestamptz)
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO order_items (id, order_id, variant_id, name_snapshot, size, qty, unit_price, total, bundle_selections)
    VALUES (gen_random_uuid(), ${orderId}, ${box.id}, ${box.name}, 'Standard', 1, 0, 0, ${JSON.stringify(bundle)}::jsonb)`);
  console.log("inserted orders + order_items.");

  // 5. Push to audit.
  await emitOrderEvent(orderId, "order.created");
  console.log("emitted order.created to audit.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
