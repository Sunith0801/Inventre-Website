/* eslint-disable no-console */
/**
 * Migrate ERPNext Customers into `parents`. Phone-deduped.
 *
 *   npx tsx scripts/migrate-from-erp/08-customers.ts [--sample=N]
 */

import { erpListPages } from "./_client";
import {
  db,
  shutdown,
  ensureCheckpointTable,
  writeCheckpoint,
  logMigrationError,
  CUTOVER_DATE,
  CUTOVER_ISO,
  DRY_RUN,
  dryRunBanner,
  newDryRunReport,
  recordDryRunDiff,
  diffRows,
  writeDryRunReport,
} from "./_db";
import { parents } from "../../db/schema";
import { eq, sql } from "drizzle-orm";

// Inlined (avoids server-only import — it's a Next.js-stubbed module).
async function generateCustomerCode(date: Date = new Date()): Promise<string> {
  const year = date.getFullYear();
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(parents)
    .where(sql`${parents.customerCode} LIKE ${`CUST-${year}-%`}`);
  const seq = String(Number(count) + 1).padStart(5, "0");
  return `CUST-${year}-${seq}`;
}

const SCRIPT = "08-customers";

type Customer = {
  name: string;
  customer_name: string;
  customer_type: string;
  customer_group?: string;
  mobile_no?: string;
  email_id?: string;
  language?: string;
  gst_category?: string;
  disabled?: number;
  is_frozen?: number;
};

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  // Take the last 10 digits (Indian mobile)
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating Customers${sample ? ` (sample ${sample})` : ""}\n`);

  let processed = 0, inserted = 0, updated = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Customer");

  for await (const page of erpListPages<Customer>("Customer", {
    fields: ["name", "customer_name", "customer_type", "customer_group", "mobile_no", "email_id", "language", "gst_category", "disabled", "is_frozen"],
    pageSize: 200,
    sample: sample || undefined,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    for (const c of page) {
      try {
        const phone = normalizePhone(c.mobile_no);
        if (!phone) {
          report.counts.unresolved_dependency++;
          await logMigrationError(SCRIPT, "Customer", c.name, "no valid 10-digit phone");
          skipped++;
          continue;
        }

        const existing = await db
          .select()
          .from(parents)
          .where(eq(parents.phone, phone))
          .limit(1);

        // ───── DANGER ZONE GUARDRAILS ─────
        // The live website (post-cutover) creates parent rows on first
        // login, then mutates a sensitive set of columns: password_hash,
        // first_time_login, tc_accepted_*, status (active on first login),
        // and the user's own name/email edits. The ERP backfill MUST never
        // touch any of those. Three rules:
        //   1. existing && createdAt >= CUTOVER → SKIP entirely (post-cutover row).
        //   2. existing && createdAt <  CUTOVER → UPDATE only the small set
        //      of catalog-style columns (name/language/gstCategory/customerGroup),
        //      with email merge only when current is null.
        //   3. no existing → INSERT (the customerCode generator path below).
        // Columns explicitly NEVER set by this script:
        //   status, isFrozen, password_hash, first_time_login,
        //   tc_accepted_at, tc_accepted_version, erp_backfilled_at.
        if (existing[0]) {
          if (existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) {
            report.counts.would_skip_post_cutover++;
            processed++;
            continue;
          }
          const updatePayload: Record<string, unknown> = {
            name: c.customer_name,
            language: c.language ?? "en",
            gstCategory: c.gst_category ?? "Unregistered",
            customerGroup: c.customer_group ?? "student",
          };
          // Only fill email when locally null — never overwrite user edits.
          if (!existing[0].email && c.email_id) {
            updatePayload.email = c.email_id;
          }
          if (DRY_RUN) {
            const changed = diffRows(
              existing[0] as unknown as Record<string, unknown>,
              updatePayload
            );
            if (changed.length === 0) report.counts.would_skip_unchanged++;
            else report.counts.would_update++;
            recordDryRunDiff(report, {
              key: c.name,
              before: existing[0] as unknown as Record<string, unknown>,
              after: updatePayload,
              changedFields: changed,
            });
          } else {
            await db
              .update(parents)
              .set(updatePayload)
              .where(eq(parents.id, existing[0].id));
          }
          updated++;
        } else {
          const insertPayload = {
            phone,
            name: c.customer_name,
            email: c.email_id ?? null,
            status: c.disabled ? "blocked" : "active",
            language: c.language ?? "en",
            gstCategory: c.gst_category ?? "Unregistered",
            isFrozen: !!c.is_frozen,
            customerGroup: c.customer_group ?? "student",
          } as const;
          if (DRY_RUN) {
            report.counts.would_insert++;
            recordDryRunDiff(report, {
              key: c.name,
              before: null,
              after: insertPayload as unknown as Record<string, unknown>,
              changedFields: Object.keys(insertPayload),
            });
          } else {
            const customerCode = await generateCustomerCode();
            await db.insert(parents).values({ ...insertPayload, customerCode });
          }
          inserted++;
        }

        processed++;
        if (processed % 100 === 0) {
          console.log(`  progress: ${processed} customers (${inserted} new, ${updated} updated, ${skipped} skipped)`);
          if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, c.name);
        }
      } catch (e) {
        report.counts.errored++;
        await logMigrationError(SCRIPT, "Customer", c.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, null, true);
  if (DRY_RUN) {
    const out = await writeDryRunReport(report);
    console.log(`\n[${SCRIPT}] dry-run ✓ counts=${JSON.stringify(report.counts)} → ${out}\n`);
  }
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${inserted} new, ${updated} updated, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
