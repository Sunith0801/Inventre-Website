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

export type MatchKind = "sku" | "erp_name" | "normalized" | "description";

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
// The audit's "Ground Stock (New)" page (/api/keeper-stock/dashboard) shows
// one row per (school, keeper SKU). Two quantities live on each row and they
// are NOT the same thing:
//
//   qty            the keeper count — one physical pile per keeper SKU, the
//                  same number repeated on every school's row (seeded from
//                  the old sheets on 2026-08-18 and rarely recounted). The
//                  page shows it only inside the count-entry sheet.
//   gs_available   what the page's table calls "Avail." — the per-school
//                  Ground Stock mirror, "Stock − Packed" for THAT school's
//                  legacy item codes. This is the number a person reading
//                  the page for a school sees, and the number the storefront
//                  must agree with (2026-09-16: SMS Grade 6 Girls Pant M22
//                  read qty 113 but Avail. 2; 1,935 of 4,292 rows differ).
//
// So a legacy code takes its row's gs_available. Rows the mirror has no
// figure for (`gs_linked` false — the page prints a dash) yield nothing:
// the storefront then treats the size as never counted. Each keeper row
// lists the legacy codes it replaced (`old_skus`) or covers; those are the
// storefront SKUs. Measured 2026-09-16: 4,292 rows, 4,638 legacy codes,
// 3,801 of them storefront SKUs, no code on more than one row. Should one
// ever be, the larger figure wins rather than the sum.

export type KeeperStockRow = {
  keeper_sku?: string | null;
  keeper_description?: string | null;
  category?: string | null;
  merch_group?: string | null;
  school_code?: string | null;
  school_name?: string | null;
  /** True for the merged General Merchandise line (one shelf, every school). */
  all_schools?: boolean | null;
  /** Keeper count (shared pile). Not the storefront figure — see above. */
  qty?: number | string | null;
  gs_linked?: boolean | null;
  gs_stock?: number | string | null;
  gs_packed?: number | string | null;
  gs_available?: number | string | null;
  gs_snapshot_at?: string | null;
  old_skus?: string[] | null;
  covers_codes?: string[] | null;
  snapshot_at?: string | null;
};

export type KeeperFigure = GroundStockFigure & {
  keeperSku: string | null;
  keeperDescription: string | null;
  keeperCategory: string | null;
  keeperGroup: string | null;
};

/**
 * One entry of the audit's keeper map (/api/inventre-catalogue/keeper-map):
 * a legacy ERP item code, the keeper SKU it became, and the school it is
 * sold to. 4,849 rows on 2026-09-16.
 */
export type KeeperMapEntry = {
  old_sku?: string | null;
  keeper_sku?: string | null;
  school_code?: string | null;
};

/** keeper SKU → its legacy codes (with school), for the fan-out below. */
export function indexKeeperMap(
  entries: KeeperMapEntry[]
): Map<string, { code: string; schoolCode: string | null }[]> {
  const out = new Map<string, { code: string; schoolCode: string | null }[]>();
  for (const e of entries) {
    const sku = (e.keeper_sku ?? "").trim();
    const code = (e.old_sku ?? "").trim();
    if (!sku || !code) continue;
    const list = out.get(sku) ?? [];
    if (!list.some((x) => x.code === code)) {
      list.push({ code, schoolCode: e.school_code ?? null });
      out.set(sku, list);
    }
  }
  return out;
}

/**
 * Which legacy codes a dashboard row stands for.
 *
 * The dashboard lists them on the row (`old_skus`) — except for General
 * Merchandise: shoes, bags and bottles are one shelf sold to every school,
 * and the audit merges those rows into a single "All schools" line whose
 * `old_skus` it deliberately empties (keeper_stock.py, the ALL_SCHOOLS
 * merge). Black 10S Shoes, for instance, is BLSHOE-10S for nine schools,
 * each with its own legacy code (`SAS BP ShoesI10S$`, `SMS ShoesI10S$` …)
 * that IS the storefront SKU. The keeper map still holds every one of
 * those, so a row's codes are the union of what it lists and what the map
 * knows for its keeper SKU — every school's codes for an "All schools"
 * row, and that school's for a per-school row.
 */
function codesForRow(
  r: KeeperStockRow,
  keeperMap: Map<string, { code: string; schoolCode: string | null }[]> | undefined
): Set<string> {
  const codes = new Set<string>();
  for (const c of [...(r.old_skus ?? []), ...(r.covers_codes ?? [])]) {
    const code = (c ?? "").trim();
    if (code) codes.add(code);
  }
  const mapped = keeperMap?.get((r.keeper_sku ?? "").trim()) ?? [];
  for (const m of mapped) {
    if (r.all_schools || !r.school_code || !m.schoolCode || m.schoolCode === r.school_code) {
      codes.add(m.code);
    }
  }
  return codes;
}

const SHARED_GROUP = "General Merchandise";

/**
 * General Merchandise — shoes, bags, bottles — is one shelf for every
 * school (user's rule, 2026-09-16). The audit already merges shoes into an
 * "All schools" line, but bags and bottles still arrive one row per school
 * with that school's mirror figure, which reads as "Samyuktha has 174 Dino
 * Charm bags, everyone else has none" when it is one pile. So every
 * merchandise keeper SKU is folded into one All-schools row carrying the
 * LARGEST figure among its school rows (the pile counted; the others echo
 * it or read zero), and its codes reach every school's SKU.
 */
function foldSharedMerchandise(rows: KeeperStockRow[]): KeeperStockRow[] {
  const out: KeeperStockRow[] = [];
  const shared = new Map<string, KeeperStockRow>();
  for (const r of rows) {
    if (r.merch_group !== SHARED_GROUP || !r.keeper_sku) {
      out.push(r);
      continue;
    }
    const cur = shared.get(r.keeper_sku);
    if (!cur) {
      shared.set(r.keeper_sku, {
        ...r,
        all_schools: true,
        school_code: null,
        school_name: "All schools",
        old_skus: [...(r.old_skus ?? [])],
        covers_codes: [...(r.covers_codes ?? [])],
      });
      continue;
    }
    cur.old_skus = [...(cur.old_skus ?? []), ...(r.old_skus ?? [])];
    cur.covers_codes = [...(cur.covers_codes ?? []), ...(r.covers_codes ?? [])];
    if (r.gs_linked && (!cur.gs_linked || num(r.gs_available) > num(cur.gs_available))) {
      cur.gs_linked = true;
      cur.gs_available = r.gs_available;
      cur.gs_stock = r.gs_stock;
      cur.gs_packed = r.gs_packed;
      cur.gs_snapshot_at = r.gs_snapshot_at ?? cur.gs_snapshot_at;
    }
  }
  return [...out, ...shared.values()];
}

export function keeperRowsToFigures(
  rows: KeeperStockRow[],
  keeperMap?: Map<string, { code: string; schoolCode: string | null }[]>
): Map<string, KeeperFigure> {
  const out = new Map<string, KeeperFigure>();
  for (const r of foldSharedMerchandise(rows)) {
    if (!r.gs_linked) continue;
    const avail = num(r.gs_available);
    const codes = codesForRow(r, keeperMap);
    for (const code of codes) {
      const cur = out.get(code);
      if (cur && cur.rawAvailable >= avail) continue;
      out.set(code, {
        itemCode: code,
        keeperSku: r.keeper_sku ?? null,
        keeperDescription: r.keeper_description ?? null,
        keeperCategory: r.category ?? null,
        keeperGroup: r.merch_group ?? null,
        schoolCode: r.school_code ?? null,
        schoolName: r.school_name ?? null,
        available: Math.max(0, Math.trunc(avail)),
        rawAvailable: avail,
        counted: num(r.gs_stock),
        packedOut: num(r.gs_packed),
        snapshotAt: r.gs_snapshot_at ?? r.snapshot_at ?? null,
      });
    }
  }
  return out;
}

// ─── Shared merchandise by NAME ──────────────────────────────────────────
//
// The storefront also sells bags and bottles as all-school products
// ("INVENTRE BAGS · RACING REX NAVY M", "WATER BOTTLES · Cloud stiper Brown")
// whose SKUs exist nowhere in the audit's keeper map — the map only knows
// the per-school codes ("SAMYU PP BAGSRRNBM$$$"). The audit's description
// carries the same words ("Primary Racing Rex Navy Blue Bag- M Size"), so a
// normalised name is the join: brand and category words dropped, sizes
// folded to S/M/L, the audit's and the storefront's spellings folded to
// one, spaces removed. Exact key first; then a key with colour qualifiers
// (navy, dark, light, sky) dropped, accepted only when it is unique on the
// audit side. Many storefront sizes may share one pile (CRIMSON BAGS and
// INVENTRE BAGS both sell Dino Charm S); that is one shelf, so both take it.

const MERCH_STOP = new Set([
  "pre", "primary", "preprimary", "secondary", "higher", "sec", "pri", "pp",
  "bag", "bags", "size", "water", "bottle", "bottles", "waterbottle", "waterbottles",
  "crimson", "schools", "school", "all", "inventre", "and", "samyu",
]);
const MERCH_FIX: [RegExp, string][] = [
  [/stiper/g, "sipper"],
  [/sippers/g, "sipper"],
  [/adevnture/g, "adventure"],
  [/turq[a-z]*/g, "turquoise"],
  [/megenta/g, "magenta"],
  [/staniless/g, "stainless"],
  [/vac+um/g, "vacuum"],
  [/\bnavy\s*blue\b/g, "navy"],
  [/\bsmall\b/g, "s"],
  [/\bmedium\b/g, "m"],
  [/\blarge\b/g, "l"],
];
const MERCH_QUALIFIERS = /\b(navy|dark|light|sky)\b/g;

/** Normalised name key; `loose` also drops colour qualifiers. */
export function merchNameKey(text: string, loose = false): string {
  let t = text.toLowerCase().replace(/[()\-:_,./]/g, " ");
  for (const [re, to] of MERCH_FIX) t = t.replace(re, to);
  if (loose) t = t.replace(MERCH_QUALIFIERS, " ");
  const words = t.split(/\s+/).filter((w) => w && !MERCH_STOP.has(w));
  return words.join("");
}

export type NamedVariant = { id: string; productName: string; size: string };

/**
 * Map storefront merchandise variants onto audit merchandise figures by
 * name. Returns variantId → the figure's key (its keeper SKU). Only
 * variants whose product name says bag or bottle are considered — shoes
 * carry a colour on the audit ("Black 10S") that the storefront-only shoe
 * products do not, so a name match there would be a guess.
 */
export function matchMerchandiseByName(
  figures: Iterable<KeeperFigure>,
  variants: NamedVariant[]
): Map<string, string> {
  const exact = new Map<string, string>();
  const loose = new Map<string, string[]>();
  for (const f of figures) {
    if (!f.keeperSku || !f.keeperDescription) continue;
    if (!/bag|bottle/i.test(f.keeperCategory ?? f.keeperDescription)) continue;
    const k = merchNameKey(f.keeperDescription);
    if (k && !exact.has(k)) exact.set(k, f.keeperSku);
    const lk = merchNameKey(f.keeperDescription, true);
    if (lk) {
      const list = loose.get(lk) ?? [];
      if (!list.includes(f.keeperSku)) list.push(f.keeperSku);
      loose.set(lk, list);
    }
  }
  const out = new Map<string, string>();
  for (const v of variants) {
    if (!/bag|bottle/i.test(v.productName)) continue;
    // The size label carries the whole name for these products; the product
    // name is only the brand line. Fall back to both joined when size is bare.
    const label = /[a-z]{3,}/i.test(v.size) ? v.size : `${v.productName} ${v.size}`;
    const k = merchNameKey(label);
    if (!k) continue;
    const hit = exact.get(k);
    if (hit) {
      out.set(v.id, hit);
      continue;
    }
    // A bare "blue" on the storefront ("Space adventure(Blue) M") could be
    // the audit's navy, sky, dark or light blue — a guess, so no loose pass.
    if (/\bblue\b/i.test(label) && !MERCH_QUALIFIERS.test(label)) continue;
    MERCH_QUALIFIERS.lastIndex = 0;
    const cands = loose.get(merchNameKey(label, true));
    if (cands && cands.length === 1) out.set(v.id, cands[0]);
  }
  return out;
}
