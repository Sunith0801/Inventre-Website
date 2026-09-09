/**
 * Browser-side fetch helpers for the exchange / missing-item submit flow.
 *
 * Why this exists: `fetch()` rejects with a bare `TypeError: Failed to fetch`
 * whenever the request never completes — a dropped mobile connection, the
 * upstream being down, a tab backgrounded mid-upload. Both forms used to put
 * `e.message` straight on screen, so parents saw the literal string
 * "Failed to fetch" with no idea what to do next. Nothing reaches nginx in
 * that case either, so the failure is invisible server-side.
 *
 * Two rules encoded here:
 *   - Retry only requests that are safe to repeat. Photo uploads are (they
 *     just stage files under a per-order key); the RTN/MIS *create* calls are
 *     NOT — a retry after the server already committed would mint a second
 *     request for the same order.
 *   - Never let the raw TypeError escape. Callers get `NetworkError` with a
 *     message written for a parent on a phone.
 */

export const NETWORK_MESSAGE =
  "We couldn't reach Inventre — your internet connection dropped while sending. " +
  "Please check your connection and tap Submit again.";

/** Thrown instead of the browser's bare "Failed to fetch" TypeError. */
export class NetworkError extends Error {
  constructor(message = NETWORK_MESSAGE, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/**
 * True for the failure modes that mean "no response ever arrived" — as
 * opposed to an HTTP error, which resolves normally and is the caller's to
 * interpret. `AbortError` is included because our own timeout aborts.
 */
function isNetworkFailure(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return e instanceof TypeError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Options = {
  /** Extra attempts after the first. 0 = never repeat the request. */
  retries?: number;
  /** Give up on a single attempt after this long. */
  timeoutMs?: number;
};

/**
 * fetch() that converts network-level failures into `NetworkError`.
 *
 * Pass `retries: 0` (the default) for anything that mutates server state
 * non-idempotently. Photo uploads pass a small retry budget.
 */
export async function fetchOrNetworkError(
  input: string,
  init: RequestInit,
  { retries = 0, timeoutMs = 120_000 }: Options = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (e) {
      if (!isNetworkFailure(e)) throw e;
      lastError = e;
      // Back off before repeating — an instant retry on a flapping mobile
      // connection just fails again.
      if (attempt < retries) await sleep(600 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new NetworkError(NETWORK_MESSAGE, { cause: lastError });
}

/**
 * Turn a non-OK Response into the message we show the parent. Falls back to
 * the status code when the body isn't our JSON envelope (an nginx 413/502
 * error page, say).
 */
export async function errorMessageFor(
  res: Response,
  fallback: string,
): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (typeof j.error === "string" && j.error) return j.error;
  if (res.status === 413)
    return "A photo was too large to upload. Please use photos under 50 MB.";
  if (res.status === 502 || res.status === 503 || res.status === 504)
    return "Inventre is temporarily unavailable. Please try again in a minute.";
  return `${fallback} (${res.status})`;
}
