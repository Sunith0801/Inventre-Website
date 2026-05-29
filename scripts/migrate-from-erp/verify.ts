/* eslint-disable no-console */
/**
 * Verify migration counts: ERP vs Inventre, per DocType.
 *
 *   npx tsx scripts/migrate-from-erp/verify.ts                  # full verify after backfill
 *   npx tsx scripts/migrate-from-erp/verify.ts --snapshot       # write pre-backfill-snapshot.json and exit
 *   npx tsx scripts/migrate-from-erp/verify.ts --check-snapshot # diff current state vs snapshot
 *
 * All ERP counts are bounded by `modified <= BACKFILL_CUTOVER_ISO` so the
 * comparison is apples-to-apples: we never want to compare the live ERP
 * (which may have post-cutover writes) against our backfilled local DB
 * (which by design only contains pre-cutover ERP rows).
 *
 * Snapshot mode captures the sensitive state of every post-cutover row
 * before the backfill runs, then `--check-snapshot` after the backfill
 * confirms NONE of those rows were modified. Any drift is a CRITICAL
 * failure — the live website's data has been clobbered.
 */

import fs from "fs";
import path from "path";
import { erpCount } from "./_client";
import {
  db,
  shutdown,
  CUTOVER_DATE,
  CUTOVER_ISO,
} from "./_db";
import { sql } from "drizzle-orm";

type Check = {
  label: string;
  erpDoctype: string;
  erpFilters?: unknown[];
  inventreCountSql: string;
  cutoffField?: "modified" | "creation" | "posting_date" | "transaction_date";
};

// Tighten tolerance for the entities the backfill is meant to converge on.
const CHECKS: Array<Check & { tolerancePct?: number }> = [
  { label: "Item Attributes",                erpDoctype: "Item Attribute", inventreCountSql: "SELECT COUNT(*) FROM product_attributes" },
  { label: "Item Groups (categories)",       erpDoctype: "Item Group",     inventreCountSql: "SELECT COUNT(*) FROM categories" },
  { label: "Items (parents)",                erpDoctype: "Item",           erpFilters: [["has_variants", "=", 1], ["disabled", "=", 0]], inventreCountSql: "SELECT COUNT(*) FROM products WHERE created_at < '" + CUTOVER_ISO + "'::timestamptz", tolerancePct: 0 },
  { label: "Item variants",                  erpDoctype: "Item",           erpFilters: [["variant_of", "is", "set"], ["disabled", "=", 0]], inventreCountSql: "SELECT COUNT(*) FROM product_variants", tolerancePct: 0 },
  { label: "Item Prices (Standard Selling)", erpDoctype: "Item Price",     erpFilters: [["price_list", "=", "Standard Selling"]], inventreCountSql: "SELECT COUNT(*) FROM item_prices WHERE created_at < '" + CUTOVER_ISO + "'::timestamptz" },
  { label: "Bins",                           erpDoctype: "Bin",            erpFilters: [["warehouse", "=", "Stores - IESPL"]], inventreCountSql: "SELECT COUNT(*) FROM bins" },
  { label: "Customers",                      erpDoctype: "Customer",       inventreCountSql: "SELECT COUNT(*) FROM parents WHERE created_at < '" + CUTOVER_ISO + "'::timestamptz", tolerancePct: 0 },
  { label: "Addresses",                      erpDoctype: "Address",        inventreCountSql: "SELECT COUNT(*) FROM addresses WHERE created_at < '" + CUTOVER_ISO + "'::timestamptz" },
  { label: "Sales Orders (Shopping Cart)",   erpDoctype: "Sales Order",    erpFilters: [["order_type", "=", "Shopping Cart"], ["docstatus", "=", 1]], cutoffField: "creation", inventreCountSql: "SELECT COUNT(*) FROM orders WHERE created_at < '" + CUTOVER_ISO + "'::timestamptz" },
  { label: "Sales Invoices",                 erpDoctype: "Sales Invoice",  erpFilters: [["docstatus", "in", [1, 2]]], cutoffField: "posting_date", inventreCountSql: "SELECT COUNT(*) FROM invoices WHERE created_at < '" + CUTOVER_ISO + "'::timestamptz" },
];

const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  "scripts/migrate-from-erp/_reports/pre-backfill-snapshot.json"
);

type Snapshot = {
  capturedAt: string;
  cutoverIso: string;
  postCutoverCounts: Record<string, number>;
  postCutoverParents: Array<{
    id: string;
    phone: string;
    has_password: boolean;
    status: string | null;
    name: string | null;
    email: string | null;
    customer_group: string | null;
    is_frozen: boolean | null;
    first_time_login: boolean | null;
    tc_accepted_version: string | null;
  }>;
};

async function captureSnapshot(): Promise<void> {
  console.log(`\n[verify] capturing pre-backfill snapshot for cutover ${CUTOVER_ISO}…\n`);

  // Per-table counts of rows the live website owns.
  const countQueries: Array<[string, string]> = [
    ["parents",         "SELECT COUNT(*) FROM parents WHERE created_at >= $1"],
    ["products",        "SELECT COUNT(*) FROM products WHERE created_at >= $1"],
    ["product_variants","SELECT COUNT(*) FROM product_variants WHERE EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND p.created_at >= $1)"],
    ["item_prices",     "SELECT COUNT(*) FROM item_prices WHERE created_at >= $1"],
    ["addresses",       "SELECT COUNT(*) FROM addresses WHERE created_at >= $1"],
    ["orders",          "SELECT COUNT(*) FROM orders WHERE created_at >= $1"],
    ["invoices",        "SELECT COUNT(*) FROM invoices WHERE created_at >= $1"],
  ];
  const postCutoverCounts: Record<string, number> = {};
  for (const [label, sqlStr] of countQueries) {
    const r: any = await db.execute(sql.raw(sqlStr.replace("$1", `'${CUTOVER_ISO}'::timestamptz`)));
    const rows = (r?.rows ?? r) as Array<{ count: string | number }>;
    postCutoverCounts[label] = Number(rows[0]?.count ?? 0);
  }

  // Field-level snapshot of every post-cutover parent — these are the rows
  // most at risk from 08-customers.
  const r: any = await db.execute(sql.raw(
    `SELECT id, phone, (password_hash IS NOT NULL) AS has_password, status, name, email,
            customer_group, is_frozen, first_time_login, tc_accepted_version
       FROM parents
      WHERE created_at >= '${CUTOVER_ISO}'::timestamptz
      ORDER BY id`
  ));
  const rows = (r?.rows ?? r) as Snapshot["postCutoverParents"];

  const snap: Snapshot = {
    capturedAt: new Date().toISOString(),
    cutoverIso: CUTOVER_ISO,
    postCutoverCounts,
    postCutoverParents: rows,
  };
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
  console.log(`  ✓ snapshot of ${rows.length} post-cutover parent rows`);
  console.log(`  ✓ post-cutover counts:`, postCutoverCounts);
  console.log(`  → ${SNAPSHOT_PATH}\n`);
}

async function checkSnapshot(): Promise<boolean> {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error(`\n[verify] no snapshot at ${SNAPSHOT_PATH} — run --snapshot first.\n`);
    return false;
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  console.log(`\n[verify] checking ${snap.postCutoverParents.length} post-cutover parents vs snapshot from ${snap.capturedAt}…\n`);

  let critical = false;

  // 1) Row-count assertions — post-cutover counts must not shrink.
  for (const [tbl, prev] of Object.entries(snap.postCutoverCounts)) {
    const sqlStr = tbl === "product_variants"
      ? `SELECT COUNT(*) FROM product_variants WHERE EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND p.created_at >= '${CUTOVER_ISO}'::timestamptz)`
      : `SELECT COUNT(*) FROM ${tbl} WHERE created_at >= '${CUTOVER_ISO}'::timestamptz`;
    const r: any = await db.execute(sql.raw(sqlStr));
    const rows = (r?.rows ?? r) as Array<{ count: string | number }>;
    const cur = Number(rows[0]?.count ?? 0);
    if (cur < prev) {
      critical = true;
      console.log(`  ✗ CRITICAL ${tbl}: post-cutover count dropped ${prev} → ${cur}`);
    } else {
      console.log(`  ✓ ${tbl}: ${cur} (was ${prev})`);
    }
  }

  // 2) Per-row parent diff — every snapshotted row must match exactly.
  const r: any = await db.execute(sql.raw(
    `SELECT id, phone, (password_hash IS NOT NULL) AS has_password, status, name, email,
            customer_group, is_frozen, first_time_login, tc_accepted_version
       FROM parents
      WHERE created_at >= '${CUTOVER_ISO}'::timestamptz`
  ));
  const curRows = (r?.rows ?? r) as Snapshot["postCutoverParents"];
  const curMap = new Map(curRows.map((row) => [row.id, row]));

  let drifted = 0;
  for (const before of snap.postCutoverParents) {
    const after = curMap.get(before.id);
    if (!after) {
      critical = true;
      drifted++;
      console.log(`  ✗ CRITICAL parents id=${before.id} phone=${before.phone}: row DELETED`);
      continue;
    }
    const changed: string[] = [];
    for (const key of Object.keys(before) as Array<keyof Snapshot["postCutoverParents"][number]>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changed.push(`${key}:${JSON.stringify(before[key])}→${JSON.stringify(after[key])}`);
      }
    }
    if (changed.length) {
      critical = true;
      drifted++;
      console.log(`  ✗ CRITICAL parents id=${before.id} phone=${before.phone}: ${changed.join(", ")}`);
    }
  }
  if (drifted === 0) console.log(`  ✓ all ${snap.postCutoverParents.length} post-cutover parents unchanged`);
  return !critical;
}

async function runCounts(): Promise<boolean> {
  console.log(`\nMigration verification (cutover ${CUTOVER_ISO})\n${"─".repeat(72)}`);
  console.log("Label                                       ERP       Inventre  Diff   %");
  console.log("─".repeat(72));
  let anyFail = false;
  for (const c of CHECKS) {
    try {
      const erp = await erpCount(c.erpDoctype, c.erpFilters ?? [], {
        cutoffIso: CUTOVER_ISO,
        cutoffField: c.cutoffField ?? "modified",
      });
      const result: any = await db.execute(sql.raw(c.inventreCountSql));
      const rows = (result?.rows ?? result) as Array<{ count: string | number }>;
      const inventre = Number(rows[0]?.count ?? 0);
      const diff = inventre - erp;
      const pct = erp === 0 ? 0 : (diff / erp) * 100;
      const tol = c.tolerancePct ?? 0.1;
      const ok = Math.abs(pct) <= tol;
      const flag = ok ? "✓" : "✗";
      console.log(
        `${flag} ${c.label.padEnd(40)} ${String(erp).padStart(8)}  ${String(inventre).padStart(8)}  ${String(diff).padStart(5)}  ${pct.toFixed(2)}%`
      );
      if (!ok) anyFail = true;
    } catch (e) {
      console.log(`✗ ${c.label}: error — ${e instanceof Error ? e.message : e}`);
      anyFail = true;
    }
  }
  console.log("─".repeat(72));
  return !anyFail;
}

async function main() {
  const args = process.argv.slice(2);
  const snapshotMode = args.includes("--snapshot");
  const checkMode = args.includes("--check-snapshot");

  let ok = true;

  if (snapshotMode) {
    await captureSnapshot();
  } else if (checkMode) {
    ok = await checkSnapshot();
  } else {
    // Full verify: counts + (if snapshot exists) post-cutover preservation.
    ok = await runCounts();
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const preserved = await checkSnapshot();
      ok = ok && preserved;
    } else {
      console.log(`\n[verify] no pre-backfill snapshot found; skipping preservation check.`);
      console.log(`         (Run \`tsx scripts/migrate-from-erp/verify.ts --snapshot\` BEFORE backfill to enable it.)\n`);
    }
  }

  await shutdown();
  if (snapshotMode) {
    process.exit(0);
  }
  if (ok) {
    console.log("\n✓ Verification PASSED.\n");
    process.exit(0);
  } else {
    console.log("\n✗ Verification FAILED — see above.\n");
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(2);
});
// Reference the imported CUTOVER_DATE so eslint/tsc don't complain about unused.
void CUTOVER_DATE;
