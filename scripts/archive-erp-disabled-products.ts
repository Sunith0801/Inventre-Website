/* eslint-disable no-console */
/**
 * One-shot: pull the live ERP item feed, find every item ERP marks
 * `disabled=true` or `is_deleted=true`, and:
 *   - flip our `products.status` to 'archived' so the storefront stops
 *     surfacing them,
 *   - mirror the flags into `products.erp_is_disabled` / `erp_is_deleted`.
 *
 * Re-enabling in ERP does NOT auto-revive — admin must flip status
 * back to 'active' explicitly. That matches the importer's new policy.
 *
 * Matches products by `erp_name` first, then `item_code` (older imports
 * stored ERPNext's auto-generated UUID-style `name` in `erp_name`; the
 * friendly id lives in `item_code`).
 *
 * Usage:
 *   tsx scripts/archive-erp-disabled-products.ts            # dry run
 *   tsx scripts/archive-erp-disabled-products.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

const ERP_FEED_BASE = process.env.ERP_FEED_BASE;
const ERP_FEED_KEY = process.env.ERP_FEED_KEY;
if (!ERP_FEED_BASE || !ERP_FEED_KEY) {
  console.error("ERP_FEED_BASE / ERP_FEED_KEY not set");
  process.exit(1);
}

type FeedItem = {
  erp_name: string;
  item_name: string;
  disabled?: boolean | number | 0 | 1;
  is_deleted?: boolean;
};

async function fetchAllItems(): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  let start = 0;
  const limit = 1000;
  for (;;) {
    const url = `${ERP_FEED_BASE}/api/items/export?start=${start}&limit=${limit}&include_deleted=true`;
    const res = await fetch(url, { headers: { "X-Feed-Key": ERP_FEED_KEY! } });
    if (!res.ok)
      throw new Error(`feed ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
    const page = (await res.json()) as { items: FeedItem[]; count: number };
    out.push(...page.items);
    if (page.count < limit) return out;
    start += limit;
  }
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("fetching ERP feed (include_deleted=true)...");
  const items = await fetchAllItems();
  const hidden = items.filter(
    (it) =>
      it.disabled === 1 ||
      it.disabled === true ||
      it.is_deleted === true
  );
  console.log(`  ${items.length} ERP items total, ${hidden.length} hidden`);

  let archived = 0;
  let alreadyArchived = 0;
  let notFound = 0;
  let touchedFlags = 0;
  const samples: string[] = [];

  for (const it of hidden) {
    const isDisabled = it.disabled === 1 || it.disabled === true;
    const isDeleted = it.is_deleted === true;
    const prodRows = (await db.execute(sql`
      SELECT id, name, status, erp_is_disabled, erp_is_deleted FROM products
       WHERE erp_name = ${it.erp_name} OR item_code = ${it.erp_name}
       LIMIT 1
    `)) as unknown as {
      id: string;
      name: string;
      status: string;
      erp_is_disabled: boolean;
      erp_is_deleted: boolean;
    }[];
    if (!prodRows[0]) {
      notFound++;
      continue;
    }
    const p = prodRows[0];
    const flagsStale =
      p.erp_is_disabled !== isDisabled || p.erp_is_deleted !== isDeleted;
    if (p.status === "archived" && !flagsStale) {
      alreadyArchived++;
      continue;
    }
    if (p.status !== "archived") archived++;
    if (flagsStale) touchedFlags++;
    if (samples.length < 30) {
      samples.push(
        `  ${APPLY ? "[update]" : "[dry-run]"} ${p.name} (id=${p.id}) status ${p.status} → archived, erp_is_disabled ${p.erp_is_disabled} → ${isDisabled}, erp_is_deleted ${p.erp_is_deleted} → ${isDeleted}`
      );
    }
    if (APPLY) {
      await db.execute(sql`
        UPDATE products
           SET status = 'archived',
               erp_is_disabled = ${isDisabled},
               erp_is_deleted = ${isDeleted},
               last_erp_sync_at = now()
         WHERE id = ${p.id}
      `);
    }
  }

  for (const s of samples) console.log(s);
  if (hidden.length - alreadyArchived - notFound > samples.length) {
    console.log(
      `  … (${hidden.length - alreadyArchived - notFound - samples.length} more)`
    );
  }

  console.log("\n=== summary ===");
  console.log(`mode:                ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`ERP hidden items:    ${hidden.length}`);
  console.log(`products archived:   ${archived}`);
  console.log(`flags updated:       ${touchedFlags}`);
  console.log(`already archived:    ${alreadyArchived}`);
  console.log(`no matching product: ${notFound}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
  if (APPLY) {
    console.log(
      "\n⚠  Restart the deploy app to flush Next.js unstable_cache:\n" +
        "   docker restart inventre-deploy-app"
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
