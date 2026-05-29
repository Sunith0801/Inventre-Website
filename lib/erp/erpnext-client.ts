/**
 * Thin client for the legacy ERPNext API at `https://erp.inventre.in`.
 *
 * Used by lib/importers/erpnext-education.ts to pull Schools, Grades,
 * Guardians, Students. Auth: `Authorization: token <api_key>:<api_secret>`.
 *
 * Env: ERPNEXT_BASE, ERPNEXT_TOKEN.
 */
import "server-only";

export type ErpNextConfig = { base?: string; token?: string };

function resolveConfig(c: ErpNextConfig = {}): { base: string; token: string } {
  const base = c.base ?? process.env.ERPNEXT_BASE ?? "";
  const token = c.token ?? process.env.ERPNEXT_TOKEN ?? "";
  if (!base) throw new Error("ERPNEXT_BASE not set");
  if (!token) throw new Error("ERPNEXT_TOKEN not set");
  return { base: base.replace(/\/$/, ""), token };
}

async function get<T>(
  path: string,
  cfg: ErpNextConfig = {}
): Promise<T> {
  const { base, token } = resolveConfig(cfg);
  const url = `${base}${path}`;
  // Per-request timeout: ERPNext can stall mid-response without closing
  // the socket, and bare fetch() has no default timeout — that hangs the
  // whole sync (and any unattended cron) forever. Abort after 45s.
  // Per-request timeout MUST cover the body read too: ERPNext often sends
  // response headers and then stalls mid-body on large pages. The abort
  // signal is shared by fetch() and res.json()/res.text() (undici ties the
  // body stream to the signal), so the timer is only cleared AFTER the body
  // is fully read — otherwise res.json() can hang forever past the timeout.
  const TIMEOUT_MS = Number(process.env.ERPNEXT_TIMEOUT_MS ?? 45000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}` },
      cache: "no-store",
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ERPNext ${res.status} ${path}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`ERPNext timeout after ${TIMEOUT_MS}ms (incl. body): ${path}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Count of rows in a doctype. Cheap probe.
 */
export async function erpCount(doctype: string, cfg: ErpNextConfig = {}): Promise<number> {
  const enc = encodeURIComponent(doctype);
  const data = await get<{ message: number }>(`/api/method/frappe.client.get_count?doctype=${enc}`, cfg);
  return data.message ?? 0;
}

/**
 * Fetch one full document by name.
 */
export async function erpGetOne<T extends Record<string, unknown>>(
  doctype: string,
  name: string,
  cfg: ErpNextConfig = {}
): Promise<T> {
  const enc = encodeURIComponent(doctype);
  const encName = encodeURIComponent(name);
  const data = await get<{ data: T }>(`/api/resource/${enc}/${encName}`, cfg);
  return data.data;
}

/**
 * List names only (cheap). Used to enumerate then fetch each.
 */
export async function erpListNames(
  doctype: string,
  opts: { start?: number; limit?: number; orderBy?: string } = {},
  cfg: ErpNextConfig = {}
): Promise<string[]> {
  const enc = encodeURIComponent(doctype);
  const start = opts.start ?? 0;
  const limit = opts.limit ?? 1000;
  const orderBy = opts.orderBy ? `&order_by=${encodeURIComponent(opts.orderBy)}` : "";
  const data = await get<{ data: { name: string }[] }>(
    `/api/resource/${enc}?limit_start=${start}&limit_page_length=${limit}&fields=%5B%22name%22%5D${orderBy}`,
    cfg
  );
  return (data.data ?? []).map((r) => r.name);
}

/**
 * Iterate every row of a doctype, fetching FULL documents.
 *
 *   pageSize: how many names to list per pagination call (max 1000 by Frappe).
 *   fetchConcurrency: how many full-document GETs to issue in parallel per page.
 *
 * Yields one full document at a time so the caller can stream-process.
 */
export async function* iterateErpDocs<T extends Record<string, unknown>>(
  doctype: string,
  opts: {
    pageSize?: number;
    fetchConcurrency?: number;
    maxRows?: number;
    onProgress?: (done: number, total?: number) => void;
  } = {},
  cfg: ErpNextConfig = {}
): AsyncGenerator<T, void, void> {
  const pageSize = opts.pageSize ?? 1000;
  const concurrency = Math.max(1, Math.min(20, opts.fetchConcurrency ?? 8));
  const maxRows = opts.maxRows;

  let start = 0;
  let done = 0;
  while (true) {
    const names = await erpListNames(doctype, { start, limit: pageSize }, cfg);
    if (names.length === 0) break;

    // Fetch each name's full doc with a small worker pool.
    const buckets: string[][] = Array.from({ length: concurrency }, () => []);
    names.forEach((n, i) => buckets[i % concurrency].push(n));

    const results: (T | null)[] = new Array(names.length).fill(null);
    const indexByName = new Map(names.map((n, i) => [n, i]));

    await Promise.all(
      buckets.map(async (bucket) => {
        for (const n of bucket) {
          try {
            const doc = await erpGetOne<T>(doctype, n, cfg);
            results[indexByName.get(n)!] = doc;
          } catch (e) {
            // Surface fetch errors but keep going; importer will count failures.
            results[indexByName.get(n)!] = { __error: String(e), name: n } as unknown as T;
          }
        }
      })
    );

    for (const doc of results) {
      if (!doc) continue;
      yield doc;
      done++;
      opts.onProgress?.(done);
      if (maxRows && done >= maxRows) return;
    }

    if (names.length < pageSize) break;
    start += pageSize;
  }
}
