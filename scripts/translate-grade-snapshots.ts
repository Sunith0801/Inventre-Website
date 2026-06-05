/* eslint-disable no-console */
/**
 * For every order_number in the input CSV that exists locally:
 *   1. Fetch ERPNext's custom_student_grade from /api/resource/Sales Order/{name}.
 *   2. Translate the raw ERPNext value via erpGradeToReal in
 *      lib/grade-translate.ts ("Grade 13" → "Grade 10", etc.).
 *   3. Write the translated value to orders.grade_snapshot.
 *
 * Dry-run by default; --apply mutates. Only orders.grade_snapshot is
 * touched — no other field.
 *
 *   ERP_API_KEY=… ERP_API_SECRET=… ERP_BASE_URL=https://erp.inventre.in \
 *   DATABASE_URL=… npx tsx scripts/translate-grade-snapshots.ts
 *   …                                                            --apply
 *   …                                                            --order=SAL-ORD-2026-25580
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { erpGradeToReal } from "@/lib/grade-translate";

type Flags = { apply: boolean; csvPath: string; order?: string };

function parseFlags(): Flags {
  const flags: Flags = {
    apply: false,
    csvPath: path.resolve(process.cwd(), "scripts/data/ccavenue-orders-to-reconcile.csv"),
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--csv=")) flags.csvPath = path.resolve(process.cwd(), arg.slice("--csv=".length));
    else if (arg.startsWith("--order=")) flags.order = arg.slice("--order=".length);
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function loadCsv(p: string): string[] {
  const out = new Set<string>();
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const first = line.split(",")[0].trim();
    if (first.startsWith("SAL-ORD-")) out.add(first);
  }
  return Array.from(out);
}

async function fetchErpGrade(orderNumber: string): Promise<string | null> {
  const base = (process.env.ERP_BASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.ERP_API_KEY;
  const secret = process.env.ERP_API_SECRET;
  if (!base || !key || !secret) throw new Error("ERP_API_KEY + ERP_API_SECRET + ERP_BASE_URL required");
  const url = `${base}/api/resource/Sales%20Order/${encodeURIComponent(orderNumber)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ERPNext GET ${orderNumber} → ${res.status}`);
  const json = (await res.json()) as { data?: { custom_student_grade?: unknown } };
  const g = json?.data?.custom_student_grade;
  return typeof g === "string" ? g : null;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

async function main() {
  const flags = parseFlags();
  const csv = loadCsv(flags.csvPath);
  const filtered = flags.order ? csv.filter((n) => n === flags.order) : csv;
  if (filtered.length === 0) {
    console.log("[grade-translate] no orders match the filter");
    return;
  }

  console.log(
    `[grade-translate] ${filtered.length} order(s)${flags.apply ? "" : "  (DRY-RUN)"}\n`,
  );
  console.log(
    [pad("order_number", 22), pad("erp_raw", 12), pad("real", 12), pad("local_before", 14), "applied"].join(" | "),
  );
  console.log("-".repeat(110));

  let updated = 0;
  let unchanged = 0;
  let notLocal = 0;
  let notInErp = 0;
  let unmapped = 0;

  for (const orderNumber of filtered) {
    let applied = "";
    let erpRaw = "—";
    let real = "—";
    let before = "—";
    try {
      const [row] = await db
        .select({ id: orders.id, grade: orders.gradeSnapshot })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      if (!row) {
        applied = "skipped:not_local";
        notLocal++;
      } else {
        before = row.grade ?? "(null)";
        const erpGrade = await fetchErpGrade(orderNumber);
        if (!erpGrade) {
          applied = "skipped:no_erp_grade";
          notInErp++;
        } else {
          erpRaw = erpGrade;
          const translated = erpGradeToReal(erpGrade);
          if (!translated) {
            applied = "skipped:unmapped";
            unmapped++;
          } else {
            real = translated;
            if (row.grade === translated) {
              applied = "unchanged";
              unchanged++;
            } else if (flags.apply) {
              await db
                .update(orders)
                .set({ gradeSnapshot: translated })
                .where(eq(orders.id, row.id));
              applied = `wrote(${before} → ${translated})`;
              updated++;
            } else {
              applied = `would_write(${before} → ${translated})`;
              updated++;
            }
          }
        }
      }
    } catch (e) {
      applied = `FAILED:${e instanceof Error ? e.message.slice(0, 40) : String(e)}`;
    }
    console.log(
      [pad(orderNumber, 22), pad(erpRaw, 12), pad(real, 12), pad(before, 14), applied].join(" | "),
    );
  }

  console.log("");
  console.log(
    `[grade-translate] summary: ${updated} ${flags.apply ? "updated" : "would update"}, ${unchanged} already correct, ${notLocal} not local, ${notInErp} no ERP grade, ${unmapped} unmapped`,
  );
  if (!flags.apply) console.log("[grade-translate] dry-run. Re-run with --apply to write.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
