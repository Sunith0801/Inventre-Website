/* eslint-disable no-console */
/**
 * One-shot: import the 22 ERPNext-only orphan Sales Orders (the June-dump
 * orders that live only in public.erp_sales_orders, never promoted to native
 * `orders`, never sent to audit) into inventre.
 *
 *   Group A (15) — abandoned online checkouts (payment EXPIRED/PENDING/FAILED):
 *       imported INVENTRE-ONLY as placed/unpaid ("Not placed") — NO audit push.
 *   Group B (7)  — OFFLINE/COD checkouts (grand_total 0): imported as
 *       confirmed + payment-success, and PUSHED TO AUDIT via erp_outbound_queue
 *       (drained by the in-container erp-drain cron with the correct secret).
 *
 *   00118 (Harini) is deliberately EXCLUDED (staff Administrator "Sales" test
 *   order, no school/grade).
 *
 * Reads the full SO docs already pulled through the audit box into
 * scratchpad/erp_orphans/<SO>.json.
 *
 *   npx tsx --conditions=react-server scripts/import-orphans-20260715.ts [--commit]
 *
 * Dry-run by default. Rollback marker: erp_raw->>'importedBy'='import-orphans-20260715'.
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
  "/tmp/claude-0/-root-Inventre/a1ebf55e-29dc-43b8-8a17-884c43b57406/scratchpad/erp_orphans";

// Group B = OFFLINE/COD -> import + push to audit as payment-success.
const GROUP_B = new Set([
  "SAL-ORD-2026-07739",
  "SAL-ORD-2026-12161",
  "SAL-ORD-2026-14720",
  "SAL-ORD-2026-16581",
  "SAL-ORD-2026-18375",
  "SAL-ORD-2026-19619",
  "SAL-ORD-2026-24118",
]);
// Group A = everything else in the folder EXCEPT the excluded staff order.
const EXCLUDE = new Set(["SAL-ORD-2026-00118"]);

const digits10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);
const paise = (n: unknown) => Math.round(Number(n || 0) * 100);

function financialYearOf(date: Date): string {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

async function one<T = any>(q: any): Promise<T | undefined> {
  const r: any = await db.execute(q);
  return (r.rows ?? r)[0];
}

// EXPIRED/FAILED -> failed, PENDING -> pending (Group A only).
function payStatusA(p: string): "failed" | "pending" {
  return String(p).toUpperCase() === "PENDING" ? "pending" : "failed";
}

type Kind = "magic_box" | "bookkit" | "uniform";
function kindOf(so: any): Kind {
  if (Number(so.custom_magic_box) === 1) return "magic_box";
  const its = so.items || [];
  const grps = its.map((it: any) => String(it.item_group || ""));
  if (grps.some((g: string) => /book/i.test(g))) return "bookkit";
  if (its.length === 1 && grps.some((g: string) => /magic/i.test(g)))
    return "magic_box"; // flag-0 magic box (rare)
  return "uniform";
}

async function resolveVariant(sku: string) {
  return one(sql`
    SELECT pv.id AS variant_id, pv.size, p.id AS product_id, p.name, p.hsn_code, p.kind
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE pv.sku = ${sku} LIMIT 1`);
}

async function processOne(soName: string) {
  const so: any = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, `${soName}.json`), "utf8")
  ).data;
  const group = GROUP_B.has(soName) ? "B" : "A";
  const kind = kindOf(so);
  const custName = so.customer_name ?? so.customer ?? "";
  const phone10 = digits10(so.contact_mobile);
  const rawEmail = (so.contact_email ?? "").trim().toLowerCase() || null;
  const PLACEHOLDER = /^(no|na|notavail|none|test|nil|xxx)@/;
  const email = rawEmail && !PLACEHOLDER.test(rawEmail) ? rawEmail : null;

  const already = await one(
    sql`SELECT id FROM orders WHERE order_number = ${soName} LIMIT 1`
  );

  const parent = await one(sql`
    SELECT id, email, name FROM parents
     WHERE right(regexp_replace(phone::text,'\\D','','g'),10) = ${phone10}
     ORDER BY created_at LIMIT 1`);

  const schoolLabel = so.custom_student_school ?? "";
  const schoolCode = String(schoolLabel).split("-")[0];
  const school = await one(sql`
    SELECT id, school_name, name FROM schools
     WHERE erp_name = ${schoolLabel} OR name = ${schoolLabel} OR school_code = ${schoolCode}
     ORDER BY (erp_name = ${schoolLabel}) DESC, (name = ${schoolLabel}) DESC
     LIMIT 1`);

  // best-effort student: same phone-parent + same school + fuzzy name
  const student = await one(sql`
    SELECT s.id, s.name, s.grade, s.school_id FROM students s
     WHERE s.parent_id = ${parent?.id ?? null}
       AND (${school?.id ?? null}::uuid IS NULL OR s.school_id = ${school?.id ?? null})
       AND lower(s.name) = lower(${custName})
     LIMIT 1`);

  // fallback: if the SO's school label didn't match, use the linked student's school.
  const schoolResolved =
    school ??
    (student?.school_id
      ? await one(
          sql`SELECT id, school_name, name FROM schools WHERE id = ${student.school_id} LIMIT 1`
        )
      : undefined);

  // grade for display: linked student's REAL grade wins over ERP's +3-offset grade.
  const gradeSnapshot = student?.grade ?? so.custom_student_grade ?? null;

  // items
  const its: any[] = so.items || [];
  const lines: any[] = [];
  const unresolved: string[] = [];
  if (kind === "uniform") {
    for (const it of its) {
      const v = await resolveVariant(it.item_code);
      if (!v) unresolved.push(it.item_code);
      lines.push({
        variant_id: v?.variant_id ?? null,
        name: v?.name ?? it.item_name ?? it.item_code,
        size: v?.size ?? null,
        qty: Number(it.qty) || 1,
        unit_price: paise(it.rate),
        total: paise(it.amount),
        hsn: v?.hsn_code ?? it.gst_hsn_code ?? null,
        bundle: null,
      });
    }
  } else {
    // magic_box | bookkit -> ONE parent line
    const it = its[0];
    const v = await resolveVariant(it.item_code);
    if (!v) unresolved.push(it.item_code);
    let bundle: any[] | null = null;
    if (kind === "magic_box") {
      bundle = [];
      for (const si of so.custom_sub_items || []) {
        const sv = await resolveVariant(si.item_code);
        const qty = Number(si.qty) || 1;
        if (!sv) {
          unresolved.push(`sub:${si.item_code}`);
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
          variantId: sv.variant_id,
          name: sv.name,
          size: sv.size ?? null,
          qty,
          attributes: sv.size ? [{ name: "Size", value: String(sv.size) }] : [],
          componentProductId: sv.product_id,
        });
      }
    }
    lines.push({
      variant_id: v?.variant_id ?? null,
      name: v?.name ?? it.item_name ?? it.item_code,
      size: it.item_code, // bookkit/box: full variant name lives in size col (mirrors existing rows)
      qty: Number(it.qty) || 1,
      unit_price: paise(it.rate),
      total: paise(it.amount),
      hsn: v?.hsn_code ?? it.gst_hsn_code ?? null,
      bundle,
    });
  }

  const status = group === "B" ? "confirmed" : "placed";
  const pay = group === "B" ? "paid" : payStatusA(so.custom_payment_status);
  const rec = {
    soName,
    group,
    kind,
    custName,
    phone10,
    email,
    grandPaise: paise(so.grand_total),
    basePaise: paise(so.base_total),
    discPaise: paise(so.discount_amount),
    status,
    pay,
    erpGrade: so.custom_student_grade ?? null,
    gradeSnapshot,
    schoolLabel: so.custom_student_school ?? null,
    parent,
    school: schoolResolved,
    student,
    lines,
    unresolved,
    already: already?.id ?? null,
    magicTag: kind === "magic_box",
    so,
  };
  return rec;
}

async function main() {
  const files = fs
    .readdirSync(SCRATCH)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((n) => !EXCLUDE.has(n))
    .sort();

  console.log(
    `[import-orphans] ${files.length} orders  mode=${
      COMMIT ? "COMMIT" : "DRY-RUN"
    }\n`
  );

  const recs = [];
  for (const n of files) recs.push(await processOne(n));

  // report
  for (const r of recs) {
    const badge = `${r.group}/${r.kind}`;
    const res = `${r.lines.filter((l: any) => l.variant_id).length}/${r.lines.length} lines`;
    console.log(
      `${r.soName} [${badge}] ${r.custName} | ${r.phone10}\n` +
        `   parent=${r.parent ? "ok" : "** MISSING **"} student=${
          r.student ? r.student.name : "(unlinked)"
        } school=${r.school ? "ok" : "** MISSING **"}\n` +
        `   status=${r.status} pay=${r.pay} | base=${(r.basePaise / 100).toFixed(
          0
        )} disc=${(r.discPaise / 100).toFixed(0)} grand=${(
          r.grandPaise / 100
        ).toFixed(0)} | ${res}${
          r.unresolved.length ? ` UNRESOLVED: ${r.unresolved.join(", ")}` : ""
        }\n` +
        `   grade_snapshot=${r.gradeSnapshot} (ERP said ${r.erpGrade}${
          r.student ? `; local student grade=${r.student.grade}` : "; unlinked"
        })${r.already ? `  !! ALREADY EXISTS ${r.already}` : ""}`
    );
  }

  const blockers = recs.filter(
    (r) => !r.parent || !r.school || r.unresolved.length || r.already
  );
  console.log(
    `\nSummary: A=${recs.filter((r) => r.group === "A").length} B=${
      recs.filter((r) => r.group === "B").length
    } | blockers=${blockers.length}${
      blockers.length ? " -> " + blockers.map((b) => b.soName).join(", ") : ""
    }`
  );

  if (!COMMIT) {
    console.log(`\n[import-orphans] dry-run, no writes.`);
    process.exit(0);
  }
  if (blockers.some((b) => !b.parent || !b.school || b.already)) {
    console.log(`\n[import-orphans] ABORT — hard blockers present; fix first.`);
    process.exit(1);
  }

  for (const r of recs) {
    const placedAt = r.so.transaction_date;
    const shippingAddress = {
      line1: (r.so.address_display || "—").replace(/<br>/g, ", ").slice(0, 250),
      receiverName: r.custName || "—",
      receiverPhone: r.phone10,
      pincode: r.so.custom_pin_code ?? null,
    };
    const erpRaw = {
      salesOrder: r.so,
      importedBy: "import-orphans-20260715",
      group: r.group,
    };
    const ins = await one(sql`
      INSERT INTO orders
        (id, order_number, parent_id, student_id, school_id, status, payment_status,
         subtotal, tax, shipping, discount, total, shipping_address, grade_snapshot,
         school_name_snapshot, financial_year, tags, erp_so_name, erp_sales_order_name,
         erp_last_polled_at, erp_raw, placed_at, confirmed_at, created_at)
      VALUES
        (gen_random_uuid(), ${r.soName}, ${r.parent!.id}, ${r.student?.id ?? null},
         ${r.school!.id}, ${r.status}::order_status, ${r.pay}::payment_status,
         ${r.basePaise}, 0, 0, ${r.discPaise}, ${r.grandPaise},
         ${JSON.stringify(shippingAddress)}::jsonb, ${r.gradeSnapshot},
         ${r.schoolLabel}, ${financialYearOf(new Date(placedAt))},
         ${r.magicTag ? sql`ARRAY['magic_box']::text[]` : sql`ARRAY[]::text[]`},
         ${r.soName}, ${r.soName}, now(), ${JSON.stringify(erpRaw)}::jsonb,
         ${placedAt}::timestamptz,
         ${r.group === "B" ? sql`${placedAt}::timestamptz` : sql`NULL`},
         ${placedAt}::timestamptz)
      ON CONFLICT (order_number) DO NOTHING
      RETURNING id`);
    if (!ins) {
      console.log(`   ${r.soName}: race skip`);
      continue;
    }
    const orderId = ins.id;

    for (const l of r.lines) {
      await db.execute(sql`
        INSERT INTO order_items
          (id, order_id, variant_id, name_snapshot, size, qty, unit_price, total,
           hsn_code_snapshot, gst_treatment_snapshot, bundle_selections)
        VALUES
          (gen_random_uuid(), ${orderId}, ${l.variant_id}, ${l.name}, ${l.size},
           ${l.qty}, ${l.unit_price}, ${l.total}, ${l.hsn},
           'nil_rated'::gst_treatment,
           ${l.bundle ? sql`${JSON.stringify(l.bundle)}::jsonb` : sql`NULL`})`);
    }

    // payments row
    await db.execute(sql`
      INSERT INTO payments
        (id, order_id, provider, amount, status, method, payment_flow,
         gateway_provider, gateway_order_id, internal_payment_reference,
         payment_mode, created_at)
      VALUES
        (gen_random_uuid(), ${orderId},
         ${r.group === "B" ? "COD" : "CCAvenue"},
         ${r.grandPaise}, ${r.pay}::payment_status,
         ${r.group === "B" ? "COD" : r.so.custom_payment_mode ?? null},
         ${r.so.custom_payment_flow ?? null},
         ${r.so.custom_gateway_provider ?? null},
         ${r.so.custom_internal_payment_reference ?? null},
         ${r.so.custom_internal_payment_reference ?? null},
         ${r.so.custom_payment_mode ?? null}, now())`);

    if (r.email && !r.parent!.email) {
      await db.execute(
        sql`UPDATE parents SET email = ${r.email} WHERE id = ${r.parent!.id} AND (email IS NULL OR email = '')`
      );
    }

    // Group B -> enqueue for audit (erp-drain cron pushes with correct secret)
    if (r.group === "B") {
      await db.execute(sql`
        INSERT INTO erp_outbound_queue
          (id, order_id, event_type, enqueued_at, scheduled_for, attempts, status)
        VALUES
          (gen_random_uuid(), ${orderId}, 'order.created', now(), now(), 0, 'pending')`);
    }

    console.log(
      `   ${r.soName}: order ${orderId} + ${r.lines.length} line(s)${
        r.group === "B" ? " + queued->audit" : " (inventre-only)"
      }`
    );
  }

  console.log(`\n[import-orphans] done.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
