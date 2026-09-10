/* eslint-disable no-console */
/**
 * One-shot: create native inventre `orders` + `order_items` for the SMS
 * (St. Michael's) Magic Box Sales Orders that exist in ERPNext but never
 * landed as native orders, then push each to audit via `order.created`.
 *
 * ERPNext is unreachable from the prod host, so this does NOT fetch live —
 * it reads the full SO docs + Address docs already pulled through the audit
 * box into the scratchpad (erp_sos.json, addrs.json).
 *
 * DEDUP: only the 10 hand-vetted SO names in TARGETS are imported. The 13
 * "already-native" (student already holds this exact box), the batch-internal
 * duplicate (27058 == 25086), and everything else are deliberately excluded —
 * one Magic Box per student is preserved.
 *
 * Grade is intentionally NOT taken from ERPNext (its custom_student_grade is
 * unreliable). grade_snapshot stays NULL; audit derives grade from the box name.
 *
 *   npx tsx --conditions=react-server scripts/import-sms-missing-magicboxes.ts [--commit]
 *
 * Dry-run by default: resolves everything and prints what it would insert/emit.
 */
import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitOrderEvent } from "@/server/erp-bridge";

const COMMIT = process.argv.includes("--commit");
const SCRATCH =
  "/tmp/claude-0/-root-Inventre/3c53a51a-05a6-4890-a564-99aa046c20bf/scratchpad";

const TARGETS = new Set([
  "SAL-ORD-2026-12284", // AM CHITRAKSH — no local student at all
  "SAL-ORD-2026-13217", // TAMSI ALEX — sibling of STEVEN ALEX
  "SAL-ORD-2026-19271", // LAKKARAJU HEMANSH — sibling of YASHIKA TALWAR
  "SAL-ORD-2026-24130", // ESHA PATRA — sibling of Avni Patra
  "SAL-ORD-2026-10361", // REVANURU DEEKSHITHARADHYA (Girls) — sibling of the Boys box
  "SAL-ORD-2026-14283", // AARADHYA GATADI (Girls) — sibling of the Boys box
  "SAL-ORD-2026-18356", // KONDROLLA ARUSH RAO (Boys) — sibling of KONDROLLA AADRIKA (Girls)
  "SAL-ORD-2026-25268", // ROHIT PAVAN (Girls) — sibling of the Boys box
  "SAL-ORD-2026-25271", // GAUTAM SAI (Girls) — sibling of the Boys box
  "SAL-ORD-2026-25511", // S PRANAV SAI (Girls) — sibling of the Boys box
]);

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
  const sos: any[] = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, "erp_sos.json"), "utf8")
  ).filter((s: any) => TARGETS.has(s.name));
  const addrs: Record<string, any> = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, "addrs.json"), "utf8")
  );

  console.log(
    `[import-sms] ${sos.length} target SOs; mode=${COMMIT ? "COMMIT" : "DRY-RUN"}\n`
  );

  const created: { id: string; so: string }[] = [];

  for (const so of sos.sort((a, b) => a.name.localeCompare(b.name))) {
    const soName: string = so.name;
    const custName: string = so.customer_name ?? so.customer ?? "";
    const phone10 = digits10(so.contact_mobile);
    const rawEmail = (so.contact_email ?? "").trim().toLowerCase() || null;
    // ERPNext holds junk placeholder emails for some SMS offline orders —
    // never let these clobber a real parent email.
    const PLACEHOLDER = /^(no|na|notavail|none|test|nil|xxx)@/;
    const email = rawEmail && !PLACEHOLDER.test(rawEmail) ? rawEmail : null;
    const boxCode: string = so.items?.[0]?.item_code;
    const subItems: any[] = Array.isArray(so.custom_sub_items)
      ? so.custom_sub_items
      : [];
    const addrName = so.shipping_address_name ?? so.customer_address ?? null;
    const addr = (addrName && addrs[addrName]) || {};

    // idempotency
    const exists = await one(
      sql`SELECT id FROM orders WHERE order_number = ${soName} LIMIT 1`
    );
    if (exists) {
      console.log(`  ${soName}  SKIP (already local as order ${exists.id})`);
      continue;
    }

    // parent: phone → name → create
    let parent = await one(
      sql`SELECT id, email FROM parents WHERE right(regexp_replace(phone::text,'\\D','','g'),10) = ${phone10} LIMIT 1`
    );
    let parentAction = "matched(phone)";
    if (!parent && custName) {
      parent = await one(
        sql`SELECT id, email FROM parents WHERE lower(trim(name)) = ${custName.toLowerCase().trim()} LIMIT 1`
      );
      if (parent) parentAction = "matched(name)";
    }
    if (!parent) {
      parentAction = "CREATE";
      if (COMMIT) {
        parent = await one(sql`
          INSERT INTO parents (id, phone, name, email, customer_group, status, created_at)
          VALUES (gen_random_uuid(), ${phone10}, ${custName || "—"}, ${email},
                  'Student', 'active', now())
          RETURNING id, email`);
      } else {
        parent = { id: "(new)", email: null };
      }
    }

    // school
    const school = await one(sql`
      SELECT id FROM schools WHERE erp_name = ${so.custom_student_school}
      UNION ALL SELECT id FROM schools WHERE name = ${so.custom_student_school}
      LIMIT 1`);

    // box variant
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
      `  ${soName}  ${custName} | ${boxCode}\n` +
        `      parent=${parentAction} school=${school ? "ok" : "MISSING"} box=${
          box ? (box.kind === "magic_box" ? "ok" : `kind=${box.kind}`) : "MISSING"
        } status=${so.status}->${status}\n` +
        `      subitems: ${bundle.length - unresolved.length}/${bundle.length} resolved${
          unresolved.length ? ` (unresolved: ${unresolved.join(", ")})` : ""
        }\n` +
        `      addr: ${shippingAddress.line1}, ${shippingAddress.city} ${shippingAddress.pincode} | ${email ?? "no-email"} | ${phone10}`
    );

    if (!box || !school) {
      console.log(`      !! cannot import — missing box/school. skipped.`);
      continue;
    }

    if (!COMMIT) continue;

    const erpRaw = {
      salesOrder: so,
      address: addr,
      fetchedAt: new Date().toISOString(),
      importedBy: "import-sms-missing-magicboxes",
    };

    const ins = await one(sql`
      INSERT INTO orders
        (id, order_number, parent_id, student_id, school_id, status, payment_status,
         subtotal, tax, shipping, discount, total, shipping_address, grade_snapshot,
         school_name_snapshot, financial_year, tags, erp_so_name, erp_sales_order_name,
         erp_last_polled_at, erp_raw, placed_at, confirmed_at, created_at)
      VALUES
        (gen_random_uuid(), ${soName}, ${parent.id}, NULL, ${school.id},
         ${status}::order_status, 'pending'::payment_status,
         0,0,0,0,0, ${JSON.stringify(shippingAddress)}::jsonb, NULL,
         ${so.custom_student_school ?? null}, ${financialYearOf(new Date(placedAt))},
         ARRAY['magic_box']::text[], ${soName}, ${soName},
         now(), ${JSON.stringify(erpRaw)}::jsonb,
         ${placedAt}::timestamptz, ${status === "delivered" ? sql`${placedAt}::timestamptz` : sql`NULL`},
         ${placedAt}::timestamptz)
      ON CONFLICT (order_number) DO NOTHING
      RETURNING id`);
    if (!ins) {
      console.log(`      race: order_number already inserted; skipped.`);
      continue;
    }
    const orderId = ins.id;

    // backfill parent email if empty
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

    console.log(`      inserted order ${orderId} + 1 box line (${bundle.length} sub-items).`);
    created.push({ id: orderId, so: soName });
  }

  if (COMMIT && created.length) {
    console.log(`\n[import-sms] emitting order.created to audit for ${created.length} orders…`);
    for (const c of created) {
      try {
        await emitOrderEvent(c.id, "order.created");
        console.log(`  pushed ${c.so}`);
      } catch (e) {
        console.log(`  FAILED push ${c.so}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  console.log(`\n[import-sms] done. ${COMMIT ? `created ${created.length}` : "dry-run, no writes"}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
