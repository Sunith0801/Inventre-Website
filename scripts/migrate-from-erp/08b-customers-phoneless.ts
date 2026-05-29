/* eslint-disable no-console */
/**
 * Second-pass customer migration for ERP customers without a valid phone.
 *
 * Audit §11: ~80% of ERPs 15,614 customers have no usable phone. The primary
 * 08-customers.ts pass (phone-deduped) skipped them. This script imports them
 * with a deterministic synthetic phone derived from the ERP name hash, so
 * their orders can still link in step 10.
 *
 * Synthetic phone format: 90DDDDDDDD (10 digits)
 *   - Prefix 90 — clearly not a real Indian mobile (no real range starts 90)
 *   - 8 digits derived from md5(erpName) mod 10^8
 *
 * These customers:
 *   - Get status="blocked" (they can never login via OTP)
 *   - notes carry the original ERP customer name for ops lookup
 *   - customerCode generated as CUST-YYYY-NNNNN (same as phoned customers)
 *
 *   npx tsx scripts/migrate-from-erp/08b-customers-phoneless.ts
 */

import crypto from "crypto";
import { erpListPages } from "./_client";
import { db, shutdown, ensureCheckpointTable, writeCheckpoint, logMigrationError } from "./_db";
import { parents } from "../../db/schema";
import { eq, sql } from "drizzle-orm";

const SCRIPT = "08b-customers-phoneless";

type Customer = {
  name: string;
  customer_name: string;
  customer_type?: string;
  customer_group?: string;
  mobile_no?: string;
  email_id?: string;
  language?: string;
  gst_category?: string;
  disabled?: number;
  is_frozen?: number;
};

function syntheticPhone(erpName: string): string {
  const h = crypto.createHash("md5").update(erpName).digest("hex");
  // Take the integer value of the first 12 hex chars, modulo 10^8 → 8 digits.
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

async function generateCustomerCode(): Promise<string> {
  const year = new Date().getFullYear();
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(parents)
    .where(sql`${parents.customerCode} LIKE ${`CUST-${year}-%`}`);
  const seq = String(Number(count) + 1).padStart(5, "0");
  return `CUST-${year}-${seq}`;
}

async function main() {
  await ensureCheckpointTable();
  console.log(`\n[${SCRIPT}] migrating phoneless ERP customers with synthetic phones\n`);

  let processed = 0, inserted = 0, skipped = 0, collisions = 0;

  for await (const page of erpListPages<Customer>("Customer", {
    fields: ["name", "customer_name", "customer_type", "customer_group", "mobile_no", "email_id", "language", "gst_category", "disabled", "is_frozen"],
    filters: [
      ["mobile_no", "is", "not set"],
    ],
    pageSize: 200,
  })) {
    for (const c of page) {
      try {
        const synthetic = syntheticPhone(c.name);

        // Check for collision
        const existing = await db
          .select()
          .from(parents)
          .where(eq(parents.phone, synthetic))
          .limit(1);
        if (existing[0]) {
          // If the existing row's notes already references this ERP name, skip (idempotent).
          if (existing[0].notes?.includes(c.name)) {
            processed++;
            continue;
          }
          // Otherwise it's a hash collision — log + skip.
          collisions++;
          await logMigrationError(SCRIPT, "Customer", c.name, `synthetic phone collision with parent ${existing[0].id}`);
          skipped++;
          continue;
        }

        const customerCode = await generateCustomerCode();
        await db.insert(parents).values({
          phone: synthetic,
          name: c.customer_name,
          email: c.email_id ?? null,
          status: "blocked",                  // can never login (no real phone)
          isFrozen: !!c.is_frozen,
          language: c.language ?? "en",
          gstCategory: c.gst_category ?? "Unregistered",
          customerGroup: c.customer_group ?? "student",
          customerCode,
          notes: `ERP-imported phoneless customer. Original ERP name: ${c.name}`,
          tags: ["erp-imported", "phoneless"],
        });
        inserted++;
        processed++;
        if (processed % 250 === 0) {
          console.log(`  progress: ${processed} phoneless customers (${inserted} new, ${collisions} collisions)`);
          await writeCheckpoint(SCRIPT, processed, c.name);
        }
      } catch (e) {
        await logMigrationError(SCRIPT, "Customer", c.name, e instanceof Error ? e.message : String(e));
        skipped++;
      }
    }
  }

  await writeCheckpoint(SCRIPT, processed, null, true);
  console.log(`\n[${SCRIPT}] ✓ done — ${processed} processed, ${inserted} new, ${collisions} collisions, ${skipped} other skips\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
