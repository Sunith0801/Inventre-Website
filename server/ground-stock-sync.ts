import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bins,
  groundStockSync,
  groundStockSyncRuns,
  productVariants,
  products,
} from "@/db/schema";
import { erpAuthedGet } from "@/server/erp-jwt";
import { getErpConfig, isErpPollConfigured } from "@/server/erp-config";
import { redis } from "@/server/redis";
import { invalidateCatalog } from "@/server/cache";
import { applyStockChange, getDefaultWarehouseId } from "@/server/repos/inventory";
import {
  indexKeeperMap,
  keeperRowsToFigures,
  matchItemCodes,
  matchMerchandiseByName,
  type KeeperMapEntry,
  type KeeperStockRow,
  type VariantMatch,
} from "@/features/stock/domain/ground-stock-match";
import { isCountedKind } from "@/features/stock/domain/availability";

/**
 * Ground Stock bridge — audit ERP → admin Stock module, every 5 minutes.
 *
 * Source (since 2026-09-16 afternoon, user's call): the audit's
 * "Ground Stock (New)" page — /api/keeper-stock/dashboard — the keeper-SKU
 * count of what is physically in the warehouse. Its rows list the legacy
 * ERP item codes each keeper SKU replaced, which is how a pile lands on a
 * storefront variant (features/stock/domain/ground-stock-match.ts,
 * `keeperRowsToFigures`). The earlier source, the per-school Ground Stock
 * dashboard, is no longer read; variants only it reported are cleared to
 * zero on the first tick after the switch.
 *
 * One tick:
 *   1. GET the keeper dashboard with the poll account (the same login the
 *      ERP status poller uses; see server/erp-jwt.ts).
 *   2. Fan every row out to its legacy item codes, one figure per code.
 *   3. Map item codes onto storefront variants (features/stock/domain).
 *   4. For every matched variant of a counted kind, set its bin in the
 *      default warehouse to the audit figure — through applyStockChange so
 *      the change is one `adjustment` ledger row, visible in the Stock
 *      module's history like any hand count.
 *   5. Variants the audit reported last tick but not this one are cleared
 *      to zero: "no stock available" must read as sold out, not as the last
 *      number we happened to see.
 *   6. Record the run; bust the catalog caches if anything moved.
 *
 * Failure mode is deliberate: if the audit cannot be reached or returns
 * nonsense, nothing is written and the previous figures stand. A stale
 * count is a smaller lie than a storefront that goes entirely sold out
 * because a login expired. The run row carries the error for the admin
 * card, and the cron log shows it.
 *
 * Reserved quantities are left alone. The audit's `available` already nets
 * out packing-seal deductions, and this storefront has never reserved a
 * unit (zero `order_reserve` ledger rows since the tables were created), so
 * actual == the audit figure and available == actual.
 */

const LOCK_KEY = "ground-stock-sync:lock";
const LOCK_TTL_SECONDS = 240;
const DASHBOARD_PATH = "/api/keeper-stock/dashboard";
// The keeper map: every legacy ERP item code → keeper SKU + school. Needed
// because the dashboard empties `old_skus` on its merged General
// Merchandise lines (shoes, bags, bottles: one shelf, every school). The
// endpoint pages at 1,000 rows with no offset, so it is read per CATEGORY
// — the largest category holds 842 rows (2026-09-16) and every row has one,
// whereas 1,142 rows carry no school and would be invisible to a per-school
// read.
const KEEPER_MAP_PATH = "/api/inventre-catalogue/keeper-map";
const KEEPER_MAP_LIMIT = 1000;
const SOURCE = "keeper";
const UNMATCHED_SAMPLE = 60;

export type GroundStockSyncResult = {
  ok: boolean;
  runId: number | null;
  rowsFetched: number;
  itemCodes: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  changed: number;
  cleared: number;
  skippedKinds: number;
  durationMs: number;
  error?: string;
  skipped?: "locked" | "not_configured";
};

type DashboardPayload = { rows?: KeeperStockRow[] };
type KeeperMapPayload = {
  rows?: KeeperMapEntry[];
  totals?: { total?: number };
  truncated?: number;
  categories?: { category?: string; count?: number }[];
};

/**
 * Read the whole keeper map, one category per request. Throws when a page
 * is truncated or the distinct rows read disagree with the endpoint's own
 * total — a partial map would silently leave a school's shoes sold out.
 */
async function fetchKeeperMap(): Promise<KeeperMapEntry[]> {
  const first = await erpAuthedGet<KeeperMapPayload>(`${KEEPER_MAP_PATH}?limit=${KEEPER_MAP_LIMIT}`);
  const categories = (first.categories ?? [])
    .map((c) => c.category)
    .filter((c): c is string => !!c);
  const expected = first.totals?.total;
  if (categories.length === 0) throw new Error("keeper map: endpoint listed no categories");
  const seen = new Map<string, KeeperMapEntry>();
  for (const cat of categories) {
    const page = await erpAuthedGet<KeeperMapPayload>(
      `${KEEPER_MAP_PATH}?limit=${KEEPER_MAP_LIMIT}&category=${encodeURIComponent(cat)}`
    );
    if ((page.truncated ?? 0) > 0) {
      throw new Error(`keeper map: category "${cat}" exceeds ${KEEPER_MAP_LIMIT} rows; page truncated`);
    }
    for (const e of page.rows ?? []) seen.set(`${e.old_sku}|${e.keeper_sku}|${e.school_code ?? ""}`, e);
  }
  if (expected != null && seen.size < expected) {
    throw new Error(`keeper map: read ${seen.size} of ${expected} rows`);
  }
  return [...seen.values()];
}

async function acquireLock(): Promise<boolean> {
  try {
    const r = await redis.set(LOCK_KEY, String(Date.now()), "EX", LOCK_TTL_SECONDS, "NX");
    return r === "OK";
  } catch {
    // Redis down: run anyway — the writes are idempotent (set-to-value), and
    // two overlapping ticks only cost duplicate ledger rows.
    return true;
  }
}

async function releaseLock(): Promise<void> {
  try {
    await redis.del(LOCK_KEY);
  } catch {
    /* ignore */
  }
}

export async function runGroundStockSync(
  trigger: "cron" | "manual" = "cron"
): Promise<GroundStockSyncResult> {
  const t0 = Date.now();
  const base: GroundStockSyncResult = {
    ok: false,
    runId: null,
    rowsFetched: 0,
    itemCodes: 0,
    matched: 0,
    unmatched: 0,
    ambiguous: 0,
    changed: 0,
    cleared: 0,
    skippedKinds: 0,
    durationMs: 0,
  };

  if (!isErpPollConfigured(getErpConfig())) {
    return { ...base, skipped: "not_configured", error: "ERP poll account not configured", durationMs: Date.now() - t0 };
  }
  if (!(await acquireLock())) {
    return { ...base, skipped: "locked", error: "a sync is already running", durationMs: Date.now() - t0 };
  }

  const [run] = await db
    .insert(groundStockSyncRuns)
    .values({ trigger })
    .returning({ id: groundStockSyncRuns.id });
  const runId = run?.id ?? null;

  const finish = async (patch: Partial<typeof groundStockSyncRuns.$inferInsert>) => {
    if (runId == null) return;
    await db
      .update(groundStockSyncRuns)
      .set({ finishedAt: new Date(), ...patch })
      .where(eq(groundStockSyncRuns.id, runId));
  };

  try {
    // 1. Fetch.
    const payload = await erpAuthedGet<DashboardPayload>(DASHBOARD_PATH);
    const rows = Array.isArray(payload?.rows) ? payload.rows : null;
    if (!rows) throw new Error("dashboard payload has no rows[]");
    if (rows.length === 0) {
      // An empty dashboard is not "everything sold out" — it is a broken
      // feed (the audit has 12 schools and ~4,300 rows). Refuse to act.
      throw new Error("dashboard returned 0 rows; leaving stock untouched");
    }

    // 2. Fan out to legacy item codes — with the keeper map, so the merged
    //    General Merchandise lines reach every school's shoe/bag/bottle SKU.
    const keeperMap = indexKeeperMap(await fetchKeeperMap());
    const figures = keeperRowsToFigures(rows, keeperMap);

    // 3. Match.
    const variantRows = await db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        erpName: productVariants.erpName,
        kind: sql<string>`${products.kind}::text`,
        productName: products.name,
        size: productVariants.size,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId));
    const kindById = new Map(variantRows.map((v) => [v.id, v.kind]));
    const { matches, unmatched, ambiguous } = matchItemCodes(figures.keys(), variantRows);

    // Only counted kinds get a bin. A kit or magic box that happens to share
    // a name with a sheet row must not be gated by it.
    const gated: VariantMatch[] = matches.filter((m) => isCountedKind(kindById.get(m.variantId)));
    const skippedKinds = matches.length - gated.length;

    // All-school bags and bottles ("INVENTRE BAGS · RACING REX NAVY M") have
    // no code in the keeper map; they take their pile by NAME. The figure is
    // filed under the keeper SKU so the sync row and ledger name the pile.
    const taken = new Set(gated.map((m) => m.variantId));
    const byKeeper = new Map<string, (typeof figures extends Map<string, infer F> ? F : never)>();
    for (const f of figures.values()) if (f.keeperSku && !byKeeper.has(f.keeperSku)) byKeeper.set(f.keeperSku, f);
    const named = matchMerchandiseByName(
      figures.values(),
      variantRows.filter((v) => !taken.has(v.id) && isCountedKind(v.kind))
    );
    for (const [variantId, keeperSku] of named) {
      const f = byKeeper.get(keeperSku);
      if (!f) continue;
      if (!figures.has(keeperSku)) figures.set(keeperSku, { ...f, itemCode: keeperSku });
      gated.push({ variantId, itemCode: keeperSku, matchKind: "description" });
    }

    // 4. Write bins + bookkeeping.
    const wh = await getDefaultWarehouseId();
    const gatedIds = gated.map((m) => m.variantId);
    // What the bridge itself wrote last time. The admin panel owns the
    // storefront's stock: a figure an admin sets in the Stock module must
    // survive the next tick. So a bin is rewritten only when the AUDIT's
    // figure moved since the last sync — not merely because the bin differs
    // from the audit. (User's rule, 2026-09-16: "in the admin panel I control
    // the storefront".)
    const lastSynced = new Map<string, number>();
    for (let i = 0; i < gatedIds.length; i += 1000) {
      const slice = gatedIds.slice(i, i + 1000);
      const rowsS = await db
        .select({ variantId: groundStockSync.variantId, available: groundStockSync.available })
        .from(groundStockSync)
        .where(inArray(groundStockSync.variantId, slice));
      for (const r of rowsS) lastSynced.set(r.variantId, r.available);
    }
    const binByVariant = new Map<string, number>();
    const CHUNK = 1000;
    for (let i = 0; i < gatedIds.length; i += CHUNK) {
      const slice = gatedIds.slice(i, i + CHUNK);
      const rowsB = await db
        .select({ variantId: bins.variantId, actualQty: bins.actualQty })
        .from(bins)
        .where(and(eq(bins.warehouseId, wh), inArray(bins.variantId, slice)));
      for (const b of rowsB) binByVariant.set(b.variantId, b.actualQty);
    }

    let changed = 0;
    const now = new Date();
    for (const m of gated) {
      const fig = figures.get(m.itemCode)!;
      const target = fig.available;
      const current = binByVariant.get(m.variantId);
      const previous = lastSynced.get(m.variantId);
      // Audit unchanged since last tick and the bin exists: leave it — it may
      // carry an admin's adjustment. A variant with no bin and a zero figure
      // still needs a bin row: the resolver reads "no bin" as "never counted".
      const auditMoved = previous == null || previous !== target;
      if (current == null || (auditMoved && current !== target)) {
        const delta = target - (current ?? 0);
        if (delta !== 0) {
          await applyStockChange(
            {
              variantId: m.variantId,
              warehouseId: wh,
              delta,
              reservedDelta: 0,
              reason: "adjustment",
              refType: "ground_stock",
              notes: `ground_stock_sync ${m.itemCode}: keeper=${fig.keeperSku ?? "-"} stock=${fig.counted} packed=${fig.packedOut} avail=${fig.rawAvailable}`,
            },
            { allowNegative: false }
          );
          changed++;
        } else if (current == null) {
          // target 0 and no bin: mint the 0/0 bin directly. applyStockChange
          // refuses to create a 0/0 row (the phantom-bin guard) — that guard
          // protects cancellations, not counts, and this row IS a count.
          await db
            .insert(bins)
            .values({ variantId: m.variantId, warehouseId: wh, actualQty: 0, reservedQty: 0 })
            .onConflictDoNothing();
          changed++;
        }
      }
      await db
        .insert(groundStockSync)
        .values({
          variantId: m.variantId,
          itemCode: m.itemCode,
          schoolCode: fig.schoolCode,
          schoolName: fig.schoolName,
          available: target,
          counted: String(fig.counted),
          packedOut: String(fig.packedOut),
          snapshotAt: fig.snapshotAt ? new Date(fig.snapshotAt) : null,
          matchKind: m.matchKind,
          keeperSku: fig.keeperSku,
          keeperDescription: fig.keeperDescription,
          keeperCategory: fig.keeperCategory,
          keeperGroup: fig.keeperGroup,
          source: SOURCE,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: groundStockSync.variantId,
          set: {
            itemCode: m.itemCode,
            schoolCode: fig.schoolCode,
            schoolName: fig.schoolName,
            available: target,
            counted: String(fig.counted),
            packedOut: String(fig.packedOut),
            snapshotAt: fig.snapshotAt ? new Date(fig.snapshotAt) : null,
            matchKind: m.matchKind,
            keeperSku: fig.keeperSku,
            keeperDescription: fig.keeperDescription,
            keeperCategory: fig.keeperCategory,
            keeperGroup: fig.keeperGroup,
            source: SOURCE,
            syncedAt: now,
          },
        });
    }

    // 5. Clear variants the audit no longer reports.
    const stale = await db
      .select({ variantId: groundStockSync.variantId, itemCode: groundStockSync.itemCode })
      .from(groundStockSync)
      .where(lt(groundStockSync.syncedAt, now));
    let cleared = 0;
    for (const s of stale) {
      const current = binByVariant.get(s.variantId);
      let actual = current;
      if (actual == null) {
        const [b] = await db
          .select({ actualQty: bins.actualQty })
          .from(bins)
          .where(and(eq(bins.variantId, s.variantId), eq(bins.warehouseId, wh)))
          .limit(1);
        actual = b?.actualQty ?? 0;
      }
      if (actual !== 0) {
        await applyStockChange(
          {
            variantId: s.variantId,
            warehouseId: wh,
            delta: -actual,
            reservedDelta: 0,
            reason: "adjustment",
            refType: "ground_stock",
            notes: `ground_stock_sync ${s.itemCode}: no longer reported by Ground Stock (New)`,
          },
          { allowNegative: true }
        );
      }
      await db.delete(groundStockSync).where(eq(groundStockSync.variantId, s.variantId));
      cleared++;
    }

    // 6. Record + bust caches.
    const result: GroundStockSyncResult = {
      ok: true,
      runId,
      rowsFetched: rows.length,
      itemCodes: figures.size,
      matched: gated.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      changed,
      cleared,
      skippedKinds,
      durationMs: Date.now() - t0,
    };
    await finish({
      ok: true,
      rowsFetched: rows.length,
      itemCodes: figures.size,
      matched: gated.length,
      unmatched: unmatched.length,
      changed,
      cleared,
      unmatchedSample: unmatched.slice(0, UNMATCHED_SAMPLE),
    });
    if (changed > 0 || cleared > 0) await invalidateCatalog();
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish({ ok: false, error: error.slice(0, 2000) }).catch(() => {});
    console.error("[ground-stock-sync]", error);
    return { ...base, runId, error, durationMs: Date.now() - t0 };
  } finally {
    await releaseLock();
  }
}

/** Status for the admin card: last runs + coverage counts. */
export async function getGroundStockSyncStatus() {
  const [runs, [coverage], [lastOk]] = await Promise.all([
    db.select().from(groundStockSyncRuns).orderBy(desc(groundStockSyncRuns.startedAt)).limit(10),
    db
      .select({
        tracked: sql<number>`count(*)::int`,
        inStock: sql<number>`count(*) filter (where ${groundStockSync.available} > 0)::int`,
        soldOut: sql<number>`count(*) filter (where ${groundStockSync.available} <= 0)::int`,
        lastSync: sql<string | null>`max(${groundStockSync.syncedAt})`,
      })
      .from(groundStockSync),
    db
      .select({ finishedAt: groundStockSyncRuns.finishedAt })
      .from(groundStockSyncRuns)
      .where(eq(groundStockSyncRuns.ok, true))
      .orderBy(desc(groundStockSyncRuns.startedAt))
      .limit(1),
  ]);
  return {
    runs,
    tracked: coverage?.tracked ?? 0,
    inStock: coverage?.inStock ?? 0,
    soldOut: coverage?.soldOut ?? 0,
    lastSync: coverage?.lastSync ?? null,
    lastOkAt: lastOk?.finishedAt ?? null,
  };
}
