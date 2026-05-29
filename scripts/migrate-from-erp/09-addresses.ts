/* eslint-disable no-console */
/**
 * Migrate ERPNext Addresses into `addresses`.
 * Address → Customer link via Dynamic Link table.
 *
 *   npx tsx scripts/migrate-from-erp/09-addresses.ts [--sample=N]
 */

import crypto from "crypto";
import { erpListPages, erpGetDoc } from "./_client";
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
  writeDryRunReport,
} from "./_db";
import { addresses, parents } from "../../db/schema";
import { and, eq } from "drizzle-orm";

const SCRIPT = "09-addresses";

// Same synthetic-phone scheme as 08b — falls back to this when ERP customer has no phone.
function syntheticPhone(erpName: string): string {
  const h = crypto.createHash("md5").update(erpName).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

type Address = {
  name: string;
  address_title?: string;
  address_type?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  phone?: string;
  gstin?: string;
  links?: { link_doctype: string; link_name: string }[];
};

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating Addresses${sample ? ` (sample ${sample})` : ""}\n`);

  let processed = 0, inserted = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Address");

  for await (const page of erpListPages<{ name: string }>("Address", {
    fields: ["name"],
    pageSize: 100,
    sample: sample || undefined,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    for (const stub of page) {
      try {
        const addr = await erpGetDoc<Address>("Address", stub.name);

        // Find customer link
        const customerLink = addr.links?.find((l) => l.link_doctype === "Customer");
        if (!customerLink) {
          report.counts.unresolved_dependency++;
          skipped++;
          continue;
        }

        // Resolve customer → parent
        // 1. Try real phone (10-digit normalized).
        // 2. Fall back to the synthetic phone hash from 08b for phoneless customers.
        const customer = await erpGetDoc<{ mobile_no?: string }>("Customer", customerLink.link_name);
        const realPhone = normalizePhone(customer.mobile_no);
        const lookupPhone = realPhone ?? syntheticPhone(customerLink.link_name);

        const parentRow = await db
          .select()
          .from(parents)
          .where(eq(parents.phone, lookupPhone))
          .limit(1);
        const phone = lookupPhone;
        if (!parentRow[0]) {
          report.counts.unresolved_dependency++;
          skipped++;
          continue;
        }

        const addressType =
          (addr.address_type ?? "shipping").toLowerCase() === "billing"
            ? "billing"
            : "shipping";
        const line1 = addr.address_line1 ?? "—";
        const pincode = addr.pincode ?? "000000";

        // Natural-key dedup so repeated runs don't multiply rows. We match
        // on (parentId, line1, pincode, addressType) — heuristic but stable
        // across runs because all four come straight from ERPNext fields.
        const existing = await db
          .select()
          .from(addresses)
          .where(
            and(
              eq(addresses.parentId, parentRow[0].id),
              eq(addresses.line1, line1),
              eq(addresses.pincode, pincode),
              eq(addresses.addressType, addressType)
            )
          )
          .limit(1);
        if (existing[0]) {
          if (existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) {
            report.counts.would_skip_post_cutover++;
          } else {
            report.counts.would_skip_unchanged++;
          }
          processed++;
          continue;
        }

        const insertPayload = {
          parentId: parentRow[0].id,
          addressTitle: addr.address_title ?? null,
          addressType,
          receiverName: addr.address_title ?? parentRow[0].name ?? "Customer",
          receiverPhone: normalizePhone(addr.phone) ?? phone,
          line1,
          line2: addr.address_line2 ?? null,
          city: addr.city ?? "—",
          state: addr.state ?? "—",
          pincode,
          country: addr.country ?? "India",
          gstin: addr.gstin ?? null,
        };

        if (DRY_RUN) {
          report.counts.would_insert++;
          recordDryRunDiff(report, {
            key: stub.name,
            before: null,
            after: insertPayload as unknown as Record<string, unknown>,
            changedFields: Object.keys(insertPayload),
          });
        } else {
          await db.insert(addresses).values(insertPayload);
        }
        inserted++;

        processed++;
        if (processed % 50 === 0) {
          console.log(`  progress: ${processed} addresses (${inserted} new, ${skipped} skipped)`);
          if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, stub.name);
        }
      } catch (e) {
        report.counts.errored++;
        await logMigrationError(SCRIPT, "Address", stub.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, null, true);
  if (DRY_RUN) {
    const out = await writeDryRunReport(report);
    console.log(`\n[${SCRIPT}] dry-run ✓ counts=${JSON.stringify(report.counts)} → ${out}\n`);
  }
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${inserted} new, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
