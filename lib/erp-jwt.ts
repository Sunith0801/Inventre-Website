import "server-only";
import { getErpConfig, isErpPollConfigured } from "@/lib/erp-config";

/**
 * JWT cache for the poll worker.
 *
 * - Logs in to ERP's /api/auth/login once and caches the bearer token.
 * - On a 401 from any subsequent call, forces a refresh and retries once.
 * - Soft TTL (~50 min) lets us refresh before ERP's typical 60-min expiry
 *   without coupling to the exact JWT lifetime.
 *
 * Module-state cache is fine because Next.js holds a per-process module
 * graph. Two app containers will simply each do their own login (cheap).
 */

type CacheEntry = { token: string; mintedAt: number; baseUrl: string };
let cache: CacheEntry | null = null;
const SOFT_TTL_MS = 50 * 60 * 1000;

function expired(c: CacheEntry, baseUrl: string): boolean {
  return c.baseUrl !== baseUrl || Date.now() - c.mintedAt > SOFT_TTL_MS;
}

async function login(baseUrl: string, user: string, pass: string): Promise<string> {
  // FastAPI OAuth2PasswordBearer expects x-www-form-urlencoded.
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `[erp-jwt] login ${res.status}: ${txt.slice(0, 200) || res.statusText}`
    );
  }
  const data = (await res.json()) as { access_token?: string; token?: string };
  const token = data.access_token || data.token;
  if (!token) throw new Error("[erp-jwt] login response missing access_token");
  return token;
}

async function getToken(force = false): Promise<string> {
  const cfg = getErpConfig();
  if (!isErpPollConfigured(cfg)) {
    throw new Error(
      `[erp-jwt] poll not configured (target=${cfg.target}); set ERP_API_BASE_URL/ERP_POLL_USER/ERP_POLL_PASS`
    );
  }
  if (!force && cache && !expired(cache, cfg.apiBaseUrl)) return cache.token;
  const token = await login(cfg.apiBaseUrl, cfg.pollUser, cfg.pollPass);
  cache = { token, mintedAt: Date.now(), baseUrl: cfg.apiBaseUrl };
  return token;
}

/**
 * Authenticated GET against the ERP. Auto-refreshes the JWT once on 401.
 * Throws on any other non-2xx so the caller can record per-row errors.
 */
export async function erpAuthedGet<T = unknown>(path: string): Promise<T> {
  const cfg = getErpConfig();
  const base = cfg.apiBaseUrl.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt > 0);
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) {
      cache = null;
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`[erp-jwt] GET ${url} ${res.status}: ${txt.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error("[erp-jwt] exhausted retries");
}

/** Manual reset (mostly for tests / admin actions). */
export function _clearJwtCache() {
  cache = null;
}
