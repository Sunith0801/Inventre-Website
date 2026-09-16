/**
 * Mapping the audit's Ground Stock rows onto storefront variants.
 *
 * Pure: the bridge (server/ground-stock-sync.ts) fetches the rows and loads
 * the variants; this module decides which row belongs to which variant and
 * what quantity it carries. Tested against the shapes seen on the live
 * dashboard on 2026-09-16.
 *
 * Keys. The audit's `item_code` is the ERP item name (`KLS Boys ShirtJ32$$`).
 * For every ERP-synced school the storefront stores that exact string in
 * `product_variants.sku` (3,354 of 3,520 codes matched by SKU on 2026-09-16),
 * and the item feed also mirrors it into `product_variants.erp_name` where
 * that was populated. Celestiia is the exception: its audit rows were
 * minted by hand with a `CELES-` prefix that the storefront SKU may lack.
 * The normalised fallback folds case, spaces, hyphens and `$` padding so
 * those and the few hyphen/space variants (`T-Shirt` vs `TShirt`) still
 * land — but only when exactly one variant answers to the key. An ambiguous
 * key is reported as unmatched rather than guessed.
 *
 * Quantities. The dashboard emits one row per (school scope, item code);
 * general merchandise is counted once under its own scope, and a code can
 * legitimately appear under two scopes. The bridge sums `available` across
 * scopes per code. Negative sums (deductions past the last count) are the
 * audit's way of saying "out" and are clamped to zero.
 */

export type GroundStockRow = {
  item_code: string;
  school_code?: string | null;
  school_name?: string | null;
  available?: number | string | null;
  counted?: number | string | null;
  packed_out?: number | string | null;
  snapshot_at?: string | null;
};

export type GroundStockFigure = {
  itemCode: string;
  schoolCode: string | null;
  schoolName: string | null;
  /** Sum of `available` across scopes, clamped at zero. */
  available: number;
  /** Raw sum, before clamping — kept so admins can see a negative figure. */
  rawAvailable: number;
  counted: number;
  packedOut: number;
  /** Latest snapshot among the scopes that contributed. */
  snapshotAt: string | null;
};

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
};

/** Fold the dashboard rows into one figure per item code. */
export function aggregateGroundStock(rows: GroundStockRow[]): Map<string, GroundStockFigure> {
  const out = new Map<string, GroundStockFigure>();
  for (const r of rows) {
    const code = (r.item_code ?? "").trim();
    if (!code) continue;
    const cur = out.get(code);
    const available = num(r.available);
    const counted = num(r.counted);
    const packedOut = num(r.packed_out);
    const snap = r.snapshot_at ?? null;
    if (!cur) {
      out.set(code, {
        itemCode: code,
        schoolCode: r.school_code ?? null,
        schoolName: r.school_name ?? null,
        available: Math.max(0, Math.trunc(available)),
        rawAvailable: available,
        counted,
        packedOut,
        snapshotAt: snap,
      });
      continue;
    }
    cur.rawAvailable += available;
    cur.available = Math.max(0, Math.trunc(cur.rawAvailable));
    cur.counted += counted;
    cur.packedOut += packedOut;
    if (snap && (!cur.snapshotAt || snap > cur.snapshotAt)) cur.snapshotAt = snap;
    // Keep the first scope's school as the label; a second scope is usually
    // the general-merchandise bucket, which is not a school.
  }
  return out;
}

export type MatchableVariant = {
  id: string;
  sku: string;
  erpName: string | null;
};

export type MatchKind = "sku" | "erp_name" | "normalized";

export type VariantMatch = {
  variantId: string;
  itemCode: string;
  matchKind: MatchKind;
};

export type MatchResult = {
  matches: VariantMatch[];
  /** Item codes no variant answers to (including ambiguous normalised keys). */
  unmatched: string[];
  /** Codes whose normalised key hit more than one variant — never guessed. */
  ambiguous: string[];
};

/** Case, whitespace, hyphens and `$` padding folded away; `CELES-` dropped. */
export function normalizeItemCode(code: string): string {
  return code
    .replace(/^CELES-/i, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Pair every item code with at most one variant, and every variant with at
 * most one item code. Exact SKU wins, then the mirrored ERP name, then the
 * normalised key when it is unique on both sides.
 */
export function matchItemCodes(
  itemCodes: Iterable<string>,
  variants: MatchableVariant[]
): MatchResult {
  const bySku = new Map<string, MatchableVariant>();
  const byErp = new Map<string, MatchableVariant>();
  const byNorm = new Map<string, MatchableVariant[]>();
  for (const v of variants) {
    if (v.sku) bySku.set(v.sku, v);
    if (v.erpName) byErp.set(v.erpName, v);
    const n = normalizeItemCode(v.sku);
    if (n) {
      const bucket = byNorm.get(n) ?? [];
      if (!bucket.some((x) => x.id === v.id)) bucket.push(v);
      byNorm.set(n, bucket);
    }
  }

  const matches: VariantMatch[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const takenVariants = new Set<string>();

  // Two passes so an exact match always beats a normalised one for the same
  // variant, whatever order the codes arrive in.
  const pending: string[] = [];
  for (const raw of itemCodes) {
    const code = raw.trim();
    if (!code) continue;
    const exact = bySku.get(code) ?? byErp.get(code);
    if (exact && !takenVariants.has(exact.id)) {
      takenVariants.add(exact.id);
      matches.push({
        variantId: exact.id,
        itemCode: code,
        matchKind: bySku.get(code) ? "sku" : "erp_name",
      });
      continue;
    }
    pending.push(code);
  }
  for (const code of pending) {
    const bucket = (byNorm.get(normalizeItemCode(code)) ?? []).filter(
      (v) => !takenVariants.has(v.id)
    );
    if (bucket.length === 1) {
      takenVariants.add(bucket[0].id);
      matches.push({ variantId: bucket[0].id, itemCode: code, matchKind: "normalized" });
    } else if (bucket.length > 1) {
      ambiguous.push(code);
      unmatched.push(code);
    } else {
      unmatched.push(code);
    }
  }
  return { matches, unmatched, ambiguous };
}

// ─── Ground Stock (New) — keeper-SKU rows ────────────────────────────────
//
// The audit's "Ground Stock (New)" page (/api/keeper-stock/dashboard) counts
// stock per KEEPER SKU — the re-branded warehouse code — one physical pile
// per SKU, fanned out into one row per school that sells it. The storefront
// still names variants by the LEGACY ERP item code, and every keeper row
// lists the legacy codes it replaced (`old_skus`) plus any it covers
// (`covers_codes`). That list is the join: each legacy code becomes a figure
// carrying the row's `qty`. Measured 2026-09-16: 4,292 rows, 4,638 legacy
// codes, 3,801 of them storefront SKUs, no code in more than one row.
//
// `qty` is the shelf. A "shared" keeper SKU is one pile several schools sell
// from, so two legacy codes of the same row deliberately read the same
// quantity — either school can sell while the pile lasts. Should a code ever
// appear under two rows, the larger figure wins rather than the sum: a pile
// counted twice is still one pile.

export type KeeperStockRow = {
  keeper_sku?: string | null;
  school_code?: string | null;
  school_name?: string | null;
  qty?: number | string | null;
  old_skus?: string[] | null;
  covers_codes?: string[] | null;
  snapshot_at?: string | null;
};

export type KeeperFigure = GroundStockFigure & { keeperSku: string | null };

export function keeperRowsToFigures(rows: KeeperStockRow[]): Map<string, KeeperFigure> {
  const out = new Map<string, KeeperFigure>();
  for (const r of rows) {
    const qty = num(r.qty);
    const codes = new Set<string>();
    for (const c of [...(r.old_skus ?? []), ...(r.covers_codes ?? [])]) {
      const code = (c ?? "").trim();
      if (code) codes.add(code);
    }
    for (const code of codes) {
      const cur = out.get(code);
      if (cur && cur.rawAvailable >= qty) continue;
      out.set(code, {
        itemCode: code,
        keeperSku: r.keeper_sku ?? null,
        schoolCode: r.school_code ?? null,
        schoolName: r.school_name ?? null,
        available: Math.max(0, Math.trunc(qty)),
        rawAvailable: qty,
        counted: qty,
        packedOut: 0,
        snapshotAt: r.snapshot_at ?? null,
      });
    }
  }
  return out;
}
