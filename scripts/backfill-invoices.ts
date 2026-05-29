/**
 * Backfill invoices for all confirmed/shipped/delivered orders that don't
 * already have a sale invoice. Idempotent: generateInvoiceForOrder checks
 * for an existing invoice per (orderId, isReturn=false) and returns the
 * existing one without creating a duplicate. Safe to re-run.
 *
 * Run from /root/Inventre with DATABASE_URL pointing at the storefront DB:
 *   export DATABASE_URL=postgres://inventre:inventre_prod@localhost:55433/inventre
 *   npx tsx scripts/backfill-invoices.ts [LIMIT]
 *
 * Optional LIMIT (default 50000) caps how many orders to process in one run.
 */
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { generateInvoiceForOrder } from "@/lib/repos/invoices";

async function main() {
  const limit = Number(process.argv[2] ?? "50000");
  const rows = (await db.execute(sql`
    SELECT o.id::text AS id, o.order_number, o.status
      FROM orders o
     WHERE o.status IN ('confirmed', 'shipped', 'delivered')
       AND NOT EXISTS (
         SELECT 1 FROM invoices i
          WHERE i.order_id = o.id AND i.is_return = false
       )
     ORDER BY o.confirmed_at DESC NULLS LAST
     LIMIT ${limit}
  `)) as unknown as { rows?: Array<{ id: string; order_number: string; status: string }> }
    | Array<{ id: string; order_number: string; status: string }>;

  const list = Array.isArray(rows) ? rows : rows.rows ?? [];
  console.log(`[backfill] candidates: ${list.length} (limit=${limit})`);

  let ok = 0, skip = 0, fail = 0;
  const failures: string[] = [];
  const t0 = Date.now();
  for (const o of list) {
    try {
      const r = await generateInvoiceForOrder({ orderId: o.id });
      if (r.alreadyExisted) skip++; else ok++;
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message.slice(0, 120) : String(e);
      failures.push(`${o.order_number}: ${msg}`);
    }
    const done = ok + skip + fail;
    if (done % 250 === 0) {
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`  [${done}/${list.length}] ok=${ok} skip=${skip} fail=${fail}  (${rate.toFixed(1)}/s)`);
    }
  }
  console.log(`\n[backfill] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  created=${ok}  already_existed=${skip}  failed=${fail}`);
  if (failures.length > 0) {
    console.log(`  first 10 failures:`);
    failures.slice(0, 10).forEach((f) => console.log(`    ${f}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
