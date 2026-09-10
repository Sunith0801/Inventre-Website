/**
 * Typed client for the ERP item-export feed.
 *
 * Source of truth: ITEMS_EXPORT_FEED.md
 *
 *   GET {ERP_FEED_BASE}/api/items/export
 *   Header: X-Feed-Key: {ERP_FEED_KEY}
 *
 * The feed returns the full item master from the ERP (no curation). We
 * always render from `effective.*` because it resolves variant→template
 * inheritance for image/school/grade/gender.
 *
 * Used by:
 *   - lib/importers/erp-item.ts          (upsert logic)
 *   - app/api/admin/erp/sync-items/*    (admin button)
 *   - app/api/cron/sync-items/*         (scheduled)
 */

export type ErpItemEffective = {
  image: string | null;
  image_url: string | null;
  image_source_url: string | null;
  image_is_local: boolean;
  custom_school_name: string | null;
  custom_grade: string | null; // comma-separated, split on `,`
  custom_gender: string | null;
  inherited_from: string | null;
};

export type ErpItem = {
  erp_name: string; // unique key — use for upsert
  item_name: string;
  description?: string | null;
  item_group: string | null;
  custom_sub_category: string | null;
  custom_school_name: string | null;
  custom_grade: string | null;
  custom_organization_mrp: number | null; // unreliable — ignore
  variant_of: string | null;
  has_variants: boolean;
  gst_hsn_code: string | null;
  stock_uom: string | null;
  is_stock_item: boolean;
  image: string | null;
  image_url: string | null;
  /** Size chart image (custom_size_chart on Item). Optional — ERP feed may
   *  not yet expose this; importer falls back to the raw bag if so. */
  custom_size_chart?: string | null;
  raw: Record<string, unknown>;
  effective: ErpItemEffective;
  // ERPNext lifecycle flags. Informational — see lib/importers/erp-item.ts
  // for how these flow into products.erp_is_disabled / erp_is_deleted.
  disabled?: boolean | 0 | 1;
  is_deleted?: boolean;
};

export type ErpItemsPage = {
  count: number;
  total: number;
  start: number;
  limit: number | null;
  include_deleted: boolean;
  generated_at: string;
  items: ErpItem[];
};

export type FeedConfig = {
  base?: string;
  key?: string;
};

function resolveConfig(c: FeedConfig = {}): { base: string; key: string } {
  const base = c.base ?? process.env.ERP_FEED_BASE ?? "";
  const key = c.key ?? process.env.ERP_FEED_KEY ?? "";
  if (!base) throw new Error("ERP_FEED_BASE not set");
  if (!key) throw new Error("ERP_FEED_KEY not set");
  return { base: base.replace(/\/$/, ""), key };
}

/**
 * Fetch a single page from the feed. Caller controls paging.
 *
 * NOTE: passing `limit: null` (or omitting it) asks the feed for ALL
 * items in one response (~6107 rows). Prefer paged calls of 1000 to
 * stay under HTTP timeouts.
 */
export async function fetchItemsPage(
  opts: {
    start?: number;
    limit?: number;
    itemGroup?: string;
    includeDeleted?: boolean;
  } = {},
  cfg: FeedConfig = {}
): Promise<ErpItemsPage> {
  const { base, key } = resolveConfig(cfg);
  const url = new URL(`${base}/api/items/export`);
  if (opts.start != null) url.searchParams.set("start", String(opts.start));
  if (opts.limit != null) url.searchParams.set("limit", String(opts.limit));
  if (opts.itemGroup) url.searchParams.set("item_group", opts.itemGroup);
  if (opts.includeDeleted) url.searchParams.set("include_deleted", "true");

  const res = await fetch(url, {
    headers: { "X-Feed-Key": key },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `ERP feed ${res.status} at ${url.pathname}${url.search}: ${await res.text().catch(() => "")}`.slice(0, 500)
    );
  }
  return (await res.json()) as ErpItemsPage;
}

/**
 * Async iterator over all pages of the feed. Yields ErpItem one at a time.
 * Default page size is 1000 (recommended in ITEMS_EXPORT_FEED.md §5).
 */
export async function* iterateItems(
  opts: { pageSize?: number; itemGroup?: string; includeDeleted?: boolean } = {},
  cfg: FeedConfig = {}
): AsyncGenerator<ErpItem, void, void> {
  const limit = opts.pageSize ?? 1000;
  let start = 0;
  // Hard cap so a runaway feed can't loop forever.
  const safetyMaxRequests = 200; // 200 * 1000 = 200k items
  for (let req = 0; req < safetyMaxRequests; req++) {
    const page = await fetchItemsPage(
      { start, limit, itemGroup: opts.itemGroup, includeDeleted: opts.includeDeleted },
      cfg
    );
    for (const it of page.items) yield it;
    if (page.count < limit) return;
    start += limit;
  }
}

/**
 * Split the comma-separated `effective.custom_grade` into a clean list.
 *
 *   "Grade 10, Grade 12, Grade 11"  ->  ["Grade 10", "Grade 12", "Grade 11"]
 *   null / ""                       ->  []
 */
export function splitGrades(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}
