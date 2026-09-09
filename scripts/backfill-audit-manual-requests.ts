/* eslint-disable no-console */
/**
 * One-shot backfill: create inventre `returns` / `missing_item_claims` rows for
 * the Customer-Care ("manual") exchange & missing requests that live in AUDIT
 * but never reflected on the storefront — because audit's push_create webhook
 * was 422'd by inventre ("No eligible order items matched"): audit ships
 * magic-box COMPONENT codes (`SMS Sports PoloB28$$`) that the old matcher,
 * which only knew standalone order lines, couldn't resolve.
 *
 * Uses the SAME bundle-aware matcher the live webhook now uses
 * (lib/audit-item-match), and for --commit calls the SAME create functions
 * (lib/audit-inbound) so behaviour is identical to a real webhook. Audit's own
 * RTN-/MIS- number is preserved (RETURNS_NUMBER_SINGLE_SOURCE is OFF in prod).
 *
 * Input: audit_manual_exchanges.json / audit_manual_missing.json in SCRATCH
 * (dumped from audit prod DB; non-rejected manual requests, items nested).
 *
 *   # dry-run (no writes) — reports would-create / deduped / no-match / no-order
 *   DATABASE_URL=postgres://inventre:inventre_prod@localhost:6433/inventre \
 *   DATABASE_DIRECT_URL=postgres://inventre:inventre_prod@localhost:55433/inventre \
 *   npx tsx --conditions=react-server scripts/backfill-audit-manual-requests.ts
 *
 *   # commit
 *   … same env … scripts/backfill-audit-manual-requests.ts --commit
 */
import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";
config({ path: path.resolve(process.cwd(), ".env.local") }); // won't override pre-set DATABASE_URL

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, returns, missingItemClaims } from "@/db/schema";
import { buildOrderMatchIndex, matchAuditItem } from "@/lib/audit-item-match";
import {
  createExchangeFromAudit,
  createMissingFromAudit,
  type AuditExchangeCreate,
  type AuditMissingCreate,
} from "@/lib/audit-inbound";

const COMMIT = process.argv.includes("--commit");
const SCRATCH =
  "/tmp/claude-0/-root-Inventre/ac8e78c0-ef72-4929-9a19-a024076b63c8/scratchpad";

interface AuditExItem { item_code: string; item_name: string | null; delivered_size: string | null; qty: number | null; line_reason: string | null; }
interface AuditEx { id: number; return_number: string; so_erp_name: string; status: string; reason: string | null; sub_reason: string | null; notes: string | null; pickup_date: string | null; items: AuditExItem[]; }
interface AuditMiItem { item_code: string; item_name: string | null; qty_short: number | null; line_notes: string | null; }
interface AuditMi { id: number; claim_number: string; so_erp_name: string; status: string; notes: string | null; items: AuditMiItem[]; }

// audit → inventre exchange status. dispatched_to_school is an audit sub-state
// after approval (replacement en route to school); inventre has no such enum,
// so it maps to "approved" (still in-progress/approved+). Others pass through.
const EX_STATUS: Record<string, string> = { dispatched_to_school: "approved" };
const mapExStatus = (s: string) => EX_STATUS[s] ?? s;

type Outcome =
  | "would_create" | "created"
  | "deduped"        // order already has a live request of this kind
  | "no_order"       // SO not in inventre
  | "no_parent"      // order has no parent_id
  | "no_match"       // items didn't resolve to any local line
  | "number_taken"   // return/claim number already exists in inventre
  | "error";

async function plan(soName: string, number: string, items: { item_code: string; item_name: string | null; delivered_size?: string | null }[], kind: "exchange" | "missing"): Promise<{ outcome: Outcome; matched: number; unmatched: string[] }> {
  const [order] = await db.select({ id: orders.id, parentId: orders.parentId, number: orders.orderNumber }).from(orders).where(eq(orders.erpSoName, soName)).limit(1);
  if (!order) return { outcome: "no_order", matched: 0, unmatched: [] };
  if (!order.parentId) return { outcome: "no_parent", matched: 0, unmatched: [] };
  // number collision (would violate the unique index on commit)
  if (kind === "exchange") {
    const [dup] = await db.select({ id: returns.id }).from(returns).where(eq(returns.returnNumber, number)).limit(1);
    if (dup) return { outcome: "number_taken", matched: 0, unmatched: [] };
    const ex = await db.select({ status: returns.status }).from(returns).where(and(eq(returns.orderId, order.id), eq(returns.kind, "exchange")));
    if (ex.some((r) => r.status !== "rejected")) return { outcome: "deduped", matched: 0, unmatched: [] };
  } else {
    const [dup] = await db.select({ id: missingItemClaims.id }).from(missingItemClaims).where(eq(missingItemClaims.claimNumber, number)).limit(1);
    if (dup) return { outcome: "number_taken", matched: 0, unmatched: [] };
    const mc = await db.select({ status: missingItemClaims.status }).from(missingItemClaims).where(eq(missingItemClaims.orderId, order.id));
    if (mc.some((r) => r.status !== "rejected")) return { outcome: "deduped", matched: 0, unmatched: [] };
  }
  // NB: the backfill intentionally bypasses the held-back filter (these are
  // already-approved CC requests; delivery is settled in audit and our
  // shipment mirror is often stale), so plan() does NOT apply it either —
  // matching commit's skipHeldBack behaviour.
  const idx = await buildOrderMatchIndex(order.id);
  let matched = 0;
  const unmatched: string[] = [];
  for (const it of items) {
    const line = matchAuditItem(idx, it);
    if (!line) { if (it.item_code) unmatched.push(it.item_code); continue; }
    matched++;
  }
  return { outcome: matched > 0 ? "would_create" : "no_match", matched, unmatched };
}

async function main() {
  console.log(`DB: ${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":***@")}`);
  console.log(`MODE: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);

  const exs: AuditEx[] = JSON.parse(fs.readFileSync(path.join(SCRATCH, "audit_manual_exchanges.json"), "utf8"));
  const mis: AuditMi[] = JSON.parse(fs.readFileSync(path.join(SCRATCH, "audit_manual_missing.json"), "utf8"));

  const tally: Record<string, number> = {};
  const bump = (o: string) => (tally[o] = (tally[o] ?? 0) + 1);
  const noMatchSamples: string[] = [];

  // ---- EXCHANGES ----
  console.log(`=== EXCHANGE (${exs.length}) ===`);
  for (const e of exs) {
    const items = (e.items ?? []).map((i) => ({ item_code: i.item_code, item_name: i.item_name, delivered_size: i.delivered_size }));
    const pl = await plan(e.so_erp_name, e.return_number, items, "exchange");
    if (!COMMIT || pl.outcome !== "would_create") {
      bump(pl.outcome);
      if (pl.outcome === "no_match" && noMatchSamples.length < 15) noMatchSamples.push(`EX ${e.return_number} ${e.so_erp_name} unmatched=${JSON.stringify(pl.unmatched)}`);
      continue;
    }
    // COMMIT
    const payload: AuditExchangeCreate = {
      return_number: e.return_number,
      so_erp_name: e.so_erp_name,
      status: mapExStatus(e.status),
      reason: e.reason ?? undefined,
      sub_reason: e.sub_reason ?? undefined,
      notes: e.notes ?? undefined,
      pickup_date: e.pickup_date ?? undefined,
      items: (e.items ?? []).map((i) => ({ item_code: i.item_code, item_name: i.item_name ?? undefined, delivered_size: i.delivered_size ?? undefined, qty: i.qty ?? 1, line_notes: i.line_reason ?? undefined })),
    };
    try {
      const res = await createExchangeFromAudit(payload, { skipHeldBack: true });
      bump(res.status === 200 ? ((res.body as { deduped?: boolean }).deduped ? "deduped" : "created") : `err_${res.status}`);
    } catch (err) {
      bump("error");
      console.error(`  ✗ EX ${e.return_number}:`, (err as Error).message);
    }
  }

  // ---- MISSING ----
  console.log(`=== MISSING (${mis.length}) ===`);
  for (const m of mis) {
    const items = (m.items ?? []).map((i) => ({ item_code: i.item_code, item_name: i.item_name, delivered_size: null }));
    const pl = await plan(m.so_erp_name, m.claim_number, items, "missing");
    if (!COMMIT || pl.outcome !== "would_create") {
      bump("MI_" + pl.outcome);
      if (pl.outcome === "no_match" && noMatchSamples.length < 30) noMatchSamples.push(`MI ${m.claim_number} ${m.so_erp_name} unmatched=${JSON.stringify(pl.unmatched)}`);
      continue;
    }
    const payload: AuditMissingCreate = {
      claim_number: m.claim_number,
      so_erp_name: m.so_erp_name,
      status: m.status,
      notes: m.notes ?? undefined,
      items: (m.items ?? []).map((i) => ({ item_code: i.item_code, item_name: i.item_name ?? undefined, qty_short: i.qty_short ?? 1, line_notes: i.line_notes ?? undefined })),
    };
    try {
      const res = await createMissingFromAudit(payload, { skipHeldBack: true });
      bump("MI_" + (res.status === 200 ? ((res.body as { deduped?: boolean }).deduped ? "deduped" : "created") : `err_${res.status}`));
    } catch (err) {
      bump("MI_error");
      console.error(`  ✗ MI ${m.claim_number}:`, (err as Error).message);
    }
  }

  console.log("\n===== TALLY =====");
  for (const k of Object.keys(tally).sort()) console.log(`  ${k.padEnd(22)} ${tally[k]}`);
  if (noMatchSamples.length) {
    console.log("\n----- no_match samples -----");
    for (const s of noMatchSamples) console.log("  " + s);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
