/**
 * One-time backfill: pull audit's per-line `packing_state` for a fixed list of
 * orders (those with an OPEN real deficiency in audit) and stamp it onto
 * erp.sales_order_items.packing_state. Read-only against audit (get_order),
 * UPDATE-only against inventre (never touches other columns). Idempotent.
 *
 *   DATABASE_URL=... ERP_API_BASE_URL=... ERP_POLL_USER=... ERP_POLL_PASS=... \
 *     npx tsx --conditions=react-server scripts/backfill-packing-state.ts <names-file>
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { erpAuthedGet } from "@/lib/erp-jwt";

type Detail = {
  header?: { name?: string };
  items?: Array<{ item_code?: string | null; packing_state?: string | null }>;
  sub_items?: Array<{ item_code?: string | null; packing_state?: string | null }>;
};

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: backfill-packing-state.ts <names-file>");
  const names = readFileSync(file, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`backfilling packing_state for ${names.length} orders`);

  let fetched = 0,
    updated = 0,
    cleared = 0,
    skipped = 0,
    errored = 0;
  for (const name of names) {
    let detail: Detail | null = null;
    try {
      detail = await erpAuthedGet<Detail>(`/api/orders/${encodeURIComponent(name)}`);
    } catch (e) {
      errored++;
      console.warn(`fetch ${name} failed:`, e instanceof Error ? e.message.slice(0, 120) : e);
      continue;
    }
    if (!detail?.header?.name) {
      skipped++;
      continue;
    }
    fetched++;
    // Both top-level Kit lines and sub-items carry packing_state and an
    // item_code; stamp whichever match the mirror's item_code.
    const rows = [...(detail.items ?? []), ...(detail.sub_items ?? [])].filter(
      (r) => r.item_code,
    );
    for (const r of rows) {
      const ps = r.packing_state ?? null;
      const res: any = await db.execute(sql`
        UPDATE erp.sales_order_items
           SET packing_state = ${ps}
         WHERE order_erp_name = ${name}
           AND item_code = ${r.item_code}
           AND packing_state IS DISTINCT FROM ${ps}
      `);
      const n = res?.rowCount ?? res?.count ?? 0;
      if (n > 0) {
        if (ps === null) cleared += n;
        else updated += n;
      }
    }
  }
  console.log(
    `done: fetched=${fetched} lines_set=${updated} lines_cleared=${cleared} skipped=${skipped} errored=${errored}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
