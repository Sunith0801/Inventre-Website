/**
 * One-time heal: re-pull SO headers whose `derived_delivery_by_category`
 * snapshot has drifted from audit's live rollup.
 *
 * Background: audit computes that map at READ time; we only snapshot it when
 * the SO row itself is mirrored. A shipment-only change (e.g. a Porter drop
 * AT the school, which audit treats as the terminal delivery) never modifies
 * audit's SO row, so the snapshot freezes and the storefront keeps rendering
 * the old pill. See lib/erp-order-header-refresh.ts.
 *
 * Candidate set: orders whose newest mirrored shipment is NEWER than the SO
 * snapshot AND whose stored map still has a non-delivered category. Anything
 * already fully delivered has nothing to gain.
 *
 * Run (dry by default):
 *   docker run --rm --network inventre-deploy_default -v /root/Inventre:/app \
 *     -w /app -e DATABASE_URL="$DBURL" -e ERP_API_BASE_URL=... \
 *     node:24-alpine npx tsx --conditions=react-server \
 *     scripts/refresh-stale-order-headers.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.deploy" });
config({ path: ".env.local" });

import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { refreshOrderHeaderMirror } from "@/server/erp-order-header-refresh";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0"
);

function base(v: string | null | undefined): string {
  return (v ?? "Pending").split(" · ")[0].trim();
}

async function main() {
  const r: any = await db.execute(sql`
    WITH s AS (
      SELECT order_erp_name, max(updated_at) AS mx
        FROM erp.outward_shipments
       WHERE is_deleted = false
       GROUP BY 1
    )
    SELECT so.erp_name,
           (so.raw::jsonb)->'derived_delivery_by_category' AS cat
      FROM erp.sales_orders so
      JOIN s ON s.order_erp_name = so.erp_name
      JOIN orders o ON o.erp_so_name = so.erp_name
     WHERE so.is_deleted = false
       AND s.mx > so.synced_at
       AND jsonb_typeof((so.raw::jsonb)->'derived_delivery_by_category') = 'object'
       AND EXISTS (
         SELECT 1
           FROM jsonb_each_text((so.raw::jsonb)->'derived_delivery_by_category') AS e(k, v)
          WHERE lower(v) NOT LIKE 'delivered%'
       )
     ORDER BY so.erp_name
  `);
  let rows = ((r?.rows ?? r) as Array<{
    erp_name: string;
    cat: Record<string, string> | null;
  }>);
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);
  console.log(`candidates: ${rows.length}${APPLY ? "" : "  (dry run)"}`);
  if (!APPLY) {
    for (const x of rows.slice(0, 20)) console.log("  ", x.erp_name, JSON.stringify(x.cat));
    return;
  }

  const before = new Map(rows.map((x) => [x.erp_name, x.cat ?? {}]));
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    if (await refreshOrderHeaderMirror(rows[i].erp_name)) ok++;
    else failed++;
    if ((i + 1) % 100 === 0) console.log(`  ...${i + 1}/${rows.length} (ok ${ok}, failed ${failed})`);
  }
  console.log(`refreshed: ${ok}, failed: ${failed}`);

  // Report what actually moved, per category.
  const after: any = await db.execute(sql`
    SELECT erp_name, (raw::jsonb)->'derived_delivery_by_category' AS cat
      FROM erp.sales_orders
     WHERE erp_name IN (${sql.join(rows.map((x) => sql`${x.erp_name}`), sql`, `)})
  `);
  let up = 0;
  let down = 0;
  for (const a of (after?.rows ?? after) as Array<{
    erp_name: string;
    cat: Record<string, string> | null;
  }>) {
    const b = before.get(a.erp_name) ?? {};
    const n = a.cat ?? {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(n)])) {
      const wasD = base(b[k]) === "Delivered";
      const isD = base(n[k]) === "Delivered";
      if (!wasD && isD) up++;
      else if (wasD && !isD) down++;
    }
  }
  console.log(`category pills pending -> delivered: ${up}; delivered -> pending: ${down}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
