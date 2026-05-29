/* eslint-disable no-console */
/**
 * Shared ERPNext HTTP client for migration scripts.
 * - Token auth, retry with exponential backoff, rate-limit awareness
 * - Cursor pagination via limit_page_length + limit_start
 * - PII-safe logging (phone/email masked)
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

const BASE = process.env.ERP_BASE_URL;
const KEY = process.env.ERP_API_KEY;
const SECRET = process.env.ERP_API_SECRET;
if (!BASE || !KEY || !SECRET) {
  throw new Error("Missing ERP_BASE_URL / ERP_API_KEY / ERP_API_SECRET in .env.local");
}

const HEADERS = {
  Authorization: `token ${KEY}:${SECRET}`,
  "Content-Type": "application/json",
};

const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 250; // gentle on the live ERP
const MAX_TRIES = 5;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function maskPhone(p: string | null | undefined): string {
  if (!p) return "";
  return p.length < 6 ? p : `${p.slice(0, 2)}XXXXXX${p.slice(-2)}`;
}

export function maskEmail(e: string | null | undefined): string {
  if (!e) return "";
  const [user, domain] = e.split("@");
  if (!domain) return e;
  return `${user.slice(0, 2)}***@${domain}`;
}

/** GET with retry + backoff. Per-attempt 15s timeout so a stalled
 *  connection (ERP holds the socket open without flushing a response)
 *  fails fast instead of hanging the whole backfill — observed in the
 *  2026-05-26 backfill where the script froze for 25+ min on a single
 *  Address row mid-paginate. */
export async function erpGet<T = unknown>(path: string): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 429) {
        const wait = parseInt(r.headers.get("Retry-After") ?? "5", 10);
        console.log(`    rate-limited; sleeping ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (r.status >= 500) {
        await sleep(1000 * Math.pow(2, attempt - 1));
        continue;
      }
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`${r.status}: ${txt.slice(0, 300)}`);
      }
      const data = (await r.json()) as { data?: T; message?: T } & T;
      return (data.data ?? data.message ?? data) as T;
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_TRIES) throw e;
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr;
}

/** Get total count of a doctype. Accepts an optional cutoffIso to count
 *  only rows whose `modified` is on/before the cutover instant — useful for
 *  apples-to-apples verification against the local backfilled table. */
export async function erpCount(
  doctype: string,
  filters: unknown[] = [],
  opts: {
    cutoffIso?: string;
    cutoffField?: "modified" | "creation" | "posting_date" | "transaction_date";
  } = {}
): Promise<number> {
  const fullFilters = opts.cutoffIso
    ? [...filters, [opts.cutoffField ?? "modified", "<=", opts.cutoffIso]]
    : filters;
  const qs = new URLSearchParams({
    doctype,
    filters: JSON.stringify(fullFilters),
  });
  const data = await erpGet<number | { message: number }>(
    `/api/method/frappe.client.get_count?${qs}`
  );
  if (typeof data === "number") return data;
  // Frappe sometimes returns {message: N}
  return Number((data as { message?: number }).message ?? data);
}

/** Paginate through a list endpoint, yielding pages of records. */
export async function* erpListPages<T = Record<string, unknown>>(
  doctype: string,
  opts: {
    fields?: string[];
    filters?: unknown[];
    pageSize?: number;
    sample?: number; // if set, stop after this many records
    /** ERP-side cutover guard. When set, an extra filter
     *  `[cutoffField, "<=", cutoffIso]` is appended so we never pull rows
     *  that ERP wrote after our local cutover. Defaults: field "modified".
     */
    cutoffIso?: string;
    cutoffField?: "modified" | "creation" | "posting_date" | "transaction_date";
  } = {}
): AsyncGenerator<T[], void, unknown> {
  const requestedPageSize = opts.pageSize ?? PAGE_SIZE;
  // Cap page size by sample when sample is set, so we never overshoot.
  const pageSize = opts.sample ? Math.min(requestedPageSize, opts.sample) : requestedPageSize;
  const fields = opts.fields ?? ["name"];
  const baseFilters = opts.filters ?? [];
  const filters = opts.cutoffIso
    ? [...baseFilters, [opts.cutoffField ?? "modified", "<=", opts.cutoffIso]]
    : baseFilters;
  let start = 0;
  let yielded = 0;
  while (true) {
    const qs = new URLSearchParams({
      fields: JSON.stringify(fields),
      filters: JSON.stringify(filters),
      limit_page_length: String(pageSize),
      limit_start: String(start),
    });
    const page = await erpGet<T[]>(
      `/api/resource/${encodeURIComponent(doctype)}?${qs}`
    );
    if (!Array.isArray(page) || page.length === 0) return;
    yield page;
    yielded += page.length;
    if (opts.sample && yielded >= opts.sample) return;
    if (page.length < pageSize) return;
    start += pageSize;
    await sleep(REQUEST_DELAY_MS);
  }
}

/** Get a single document by name (URL-encoded). */
export async function erpGetDoc<T = Record<string, unknown>>(
  doctype: string,
  name: string
): Promise<T> {
  return erpGet<T>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
}
