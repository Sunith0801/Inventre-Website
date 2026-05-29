import "server-only";

/**
 * Legacy ERPNext REST client — talks to ERP_BASE_URL via token auth
 * (`Authorization: token <key>:<secret>`). The original erp.inventre.in
 * host is retired (2026-05) so admin code should NOT call this on hot
 * paths anymore — all the coupon CRUD that used to mirror to ERP is now
 * local-only. This client remains for one-shot import scripts and any
 * future revival of a live ERPNext endpoint.
 *
 * The `AbortSignal.timeout` below caps each attempt at 8 seconds so a
 * dead host fails fast instead of hanging on the kernel TCP timeout
 * (~60-120s) which previously caused admin requests to spin for ~2
 * minutes (3 attempts × 60s).
 */

export type ErpFetchOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Number of times to retry on 5xx (default 2). */
  retries?: number;
};

export async function erpFetch<T>(
  path: string,
  opts: ErpFetchOpts = {}
): Promise<T> {
  const base = process.env.ERP_BASE_URL;
  const key = process.env.ERP_API_KEY;
  const secret = process.env.ERP_API_SECRET;
  if (!base || !key || !secret) {
    throw new Error("ERP not configured: ERP_BASE_URL/ERP_API_KEY/ERP_API_SECRET");
  }
  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: `token ${key}:${secret}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;
  for (let i = 0; i <= retries; i++) {
    try {
      // Per-attempt 8s cap. Worst-case wall time = 3 × 8s + backoffs ≈ 25s
      // when the host is dead/unreachable, vs the previous ~2 minutes
      // (per-attempt kernel TCP timeout × 3).
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      if (res.status >= 500 && i < retries) {
        await new Promise((r) => setTimeout(r, 250 * Math.pow(2, i)));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ERP ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, 250 * Math.pow(2, i)));
    }
  }
  throw lastErr ?? new Error("ERP fetch failed");
}

export function isErpConfigured(): boolean {
  return !!(
    process.env.ERP_BASE_URL &&
    process.env.ERP_API_KEY &&
    process.env.ERP_API_SECRET
  );
}
