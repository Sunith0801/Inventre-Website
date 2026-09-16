/**
 * Server-side paging for admin list pages: `?page=` and `?perPage=` in the
 * URL, LIMIT/OFFSET in the query, and the numbers <Pagination> needs.
 *
 * Same URL contract as the Users screen (lib/admin-users-view.ts) so paging
 * reads the same everywhere: `page` is omitted on page 1 and `perPage` is
 * omitted at the default.
 *
 * WHY. Several list pages rendered every row they had — 1,628 bundles, every
 * coupon — or silently stopped at 500 and then computed totals from that
 * truncated slice. Each rendered row costs server time and HTML, so those
 * pages took 3–10 s to open.
 */

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 50;

export type Paging = { page: number; perPage: number; offset: number };

type RawParam = string | string[] | undefined;
const one = (v: RawParam) => (Array.isArray(v) ? v[0] : v);

export function readPaging(sp: { page?: RawParam; perPage?: RawParam }): Paging {
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const requested = Number.parseInt(one(sp.perPage) ?? "", 10);
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_PER_PAGE;
  return { page, perPage, offset: (page - 1) * perPage };
}

/** Page count and the 1-based record range for the "Showing x–y of N" readout. */
export function pageMeta(total: number, { page, perPage }: Paging) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : Math.min(total, (page - 1) * perPage + 1);
  const to = Math.min(total, page * perPage);
  return { pages, from, to };
}

/** `href` with its page/perPage params replaced; every other param is kept. */
export function withPaging(href: string, page: number, perPage: number): string {
  const url = new URL(href, "http://admin.local");
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  if (perPage !== DEFAULT_PER_PAGE) url.searchParams.set("perPage", String(perPage));
  else url.searchParams.delete("perPage");
  return url.pathname + url.search;
}
