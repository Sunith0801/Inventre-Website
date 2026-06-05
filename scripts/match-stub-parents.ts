/* eslint-disable no-console */
/**
 * Dry-run report: for each CCAvenue-stub order (still linked to a
 * placeholder parent), fetch ERPNext's contact_mobile and check
 * whether a real local parents row exists with the same last-10-digit
 * phone. Reports matches; writes nothing.
 *
 *   ERP_API_KEY=… ERP_API_SECRET=… ERP_BASE_URL=https://erp.inventre.in \
 *   DATABASE_URL=… npx tsx scripts/match-stub-parents.ts
 *   …                                                       --limit=10
 *   …                                                       --order=SAL-ORD-2026-25580
 *
 * Output columns: order_number, current_parent_phone, erp_contact_mobile,
 * matched_parent_id, matched_parent_name. Trailing summary with totals.
 *
 * Selection: orders.parent_id points at a `parents.status='blocked'`
 * row whose name begins with "CCAvenue stub" (the marker we wrote in
 * verify-ccavenue-then-import.ts). We could broaden this to any
 * placeholder, but limiting to our explicit marker keeps the audit
 * trail clean.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

type Flags = { limit?: number; order?: string; apply: boolean };

function parseFlags(): Flags {
  const flags: Flags = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--order=")) flags.order = arg.slice("--order=".length);
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

type Stub = { order_number: string; current_parent_id: string; current_parent_phone: string };

async function findStubs(flags: Flags): Promise<Stub[]> {
  const orderFilter = flags.order ? sql`AND o.order_number = ${flags.order}` : sql``;
  const limitClause = flags.limit ? sql`LIMIT ${flags.limit}` : sql``;
  const r: any = await db.execute(sql`
    SELECT o.order_number,
           o.parent_id AS current_parent_id,
           p.phone     AS current_parent_phone
      FROM orders o
      JOIN parents p ON p.id = o.parent_id
     WHERE p.status = 'blocked'
       AND p.name LIKE 'CCAvenue stub %'
       ${orderFilter}
     ORDER BY o.order_number
     ${limitClause};
  `);
  return ((r?.rows ?? r ?? []) as Stub[]);
}

async function fetchErpContactMobile(orderNumber: string): Promise<{ contactMobile: string | null; customerName: string | null }> {
  const base = (process.env.ERP_BASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.ERP_API_KEY;
  const secret = process.env.ERP_API_SECRET;
  if (!base || !key || !secret) {
    throw new Error("ERP_API_KEY + ERP_API_SECRET + ERP_BASE_URL must be set");
  }
  const url = `${base}/api/resource/Sales%20Order/${encodeURIComponent(orderNumber)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return { contactMobile: null, customerName: null };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ERPNext GET ${orderNumber} → ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Record<string, unknown> };
  const d = json?.data ?? {};
  return {
    contactMobile: typeof d.contact_mobile === "string" ? (d.contact_mobile as string) : null,
    customerName: typeof d.customer_name === "string" ? (d.customer_name as string) : null,
  };
}

function last10(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

async function matchParentByPhone(phone10: string, stubParentId: string): Promise<{ id: string; name: string | null; phone: string } | null> {
  if (phone10.length !== 10) return null;
  const r: any = await db.execute(sql`
    SELECT id, name, phone
      FROM parents
     WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${phone10}
       AND id != ${stubParentId}
       AND status != 'blocked'
     LIMIT 1;
  `);
  const rows = (r?.rows ?? r ?? []) as { id: string; name: string | null; phone: string }[];
  return rows[0] ?? null;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

async function main() {
  const flags = parseFlags();
  const stubs = await findStubs(flags);
  if (stubs.length === 0) {
    console.log("[match-stubs] no stub orders match the filter");
    return;
  }
  console.log(
    `[match-stubs] ${stubs.length} stub(s)${flags.apply ? " — APPLYING re-links" : " — DRY-RUN ONLY"}\n`,
  );
  console.log(
    [
      pad("order_number", 22),
      pad("erp_mobile", 14),
      pad("matched", 8),
      pad("real_parent_id", 38),
      "real_parent_name",
    ].join(" | "),
  );
  console.log("-".repeat(140));

  let matched = 0;
  let noErpMobile = 0;
  let noLocalMatch = 0;
  let erpErrors = 0;

  for (const s of stubs) {
    let erpMobile = "—";
    let matchedFlag = "—";
    let realId = "—";
    let realName = "—";
    try {
      const { contactMobile } = await fetchErpContactMobile(s.order_number);
      if (!contactMobile) {
        noErpMobile++;
      } else {
        erpMobile = contactMobile;
        const phone10 = last10(contactMobile);
        if (phone10.length === 10) {
          const real = await matchParentByPhone(phone10, s.current_parent_id);
          if (real) {
            matched++;
            matchedFlag = "yes";
            realId = real.id;
            realName = real.name ?? "—";
            if (flags.apply) {
              await db.execute(sql`
                UPDATE orders SET parent_id = ${real.id}
                 WHERE order_number = ${s.order_number}
                   AND parent_id = ${s.current_parent_id};
              `);
            }
          } else {
            noLocalMatch++;
            matchedFlag = "no";
          }
        } else {
          noErpMobile++;
        }
      }
    } catch (e) {
      erpErrors++;
      erpMobile = `ERR:${e instanceof Error ? e.message.slice(0, 8) : "?"}`;
    }
    console.log(
      [
        pad(s.order_number, 22),
        pad(erpMobile, 14),
        pad(matchedFlag, 8),
        pad(realId, 38),
        realName,
      ].join(" | "),
    );
  }

  console.log("");
  console.log(
    `[match-stubs] summary: ${stubs.length} stubs, ${matched} ${flags.apply ? "re-linked" : "would re-link"}, ${noLocalMatch} no local parent, ${noErpMobile} no ERP mobile, ${erpErrors} ERP errors`,
  );
  if (!flags.apply) console.log("[match-stubs] DRY-RUN ONLY — nothing was written");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
