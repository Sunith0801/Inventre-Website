import "server-only";
import crypto from "crypto";

/**
 * CCAvenue gateway helpers.
 *
 * CCAvenue uses an outdated AES-128-CBC scheme with a derived MD5 key and a
 * fixed IV. Reference: CCAvenue iframe / non-seamless redirect integration kit
 * (Java/PHP/Node samples on the merchant portal).
 *
 * Required env to enable production:
 *   CCAVENUE_MERCHANT_ID    — numeric merchant ID
 *   CCAVENUE_ACCESS_CODE    — public access code
 *   CCAVENUE_WORKING_KEY    — 32-char hex string (kept server-side; rotates)
 *   CCAVENUE_API_BASE       — https://test.ccavenue.com or https://www.ccavenue.com
 *   CCAVENUE_REDIRECT_URL   — full URL to /api/checkout/ccavenue/callback
 *   CCAVENUE_CANCEL_URL     — full URL to your cancel page
 *
 * IMPORTANT: this module ships the wire shape and crypto only. Real
 * integration also requires:
 *   - Whitelisting your callback URL with CCAvenue support
 *   - A merchant account (UAT first, then live)
 *   - An end-to-end UAT round-trip test with a real card
 *
 * Treat the encryption + checksum routines as battle-tested ONLY after that
 * round-trip has succeeded.
 */

export type CCAvenueConfig = {
  merchantId: string;
  accessCode: string;
  workingKey: string;
  apiBase: string;
  redirectUrl: string;
  cancelUrl: string;
};

export function isCCAvenueConfigured(): boolean {
  return !!(
    process.env.CCAVENUE_MERCHANT_ID &&
    process.env.CCAVENUE_ACCESS_CODE &&
    process.env.CCAVENUE_WORKING_KEY &&
    process.env.CCAVENUE_API_BASE
  );
}

export function getCCAvenueConfig(): CCAvenueConfig {
  if (!isCCAvenueConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CCAvenue env vars missing (CCAVENUE_MERCHANT_ID/ACCESS_CODE/WORKING_KEY/API_BASE)."
      );
    }
    // Dev stub — surface clear error if anyone hits the gateway path.
    throw new Error("CCAvenue not configured (set CCAVENUE_* env vars).");
  }
  return {
    merchantId: process.env.CCAVENUE_MERCHANT_ID!,
    accessCode: process.env.CCAVENUE_ACCESS_CODE!,
    workingKey: process.env.CCAVENUE_WORKING_KEY!,
    apiBase: process.env.CCAVENUE_API_BASE!.replace(/\/$/, ""),
    redirectUrl:
      process.env.CCAVENUE_REDIRECT_URL ?? "https://example.com/api/checkout/ccavenue/callback",
    cancelUrl: process.env.CCAVENUE_CANCEL_URL ?? "https://example.com/checkout/cancel",
  };
}

// CCAvenue's IV is fixed in their reference implementation.
const FIXED_IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
  0x0c, 0x0d, 0x0e, 0x0f,
]);

function deriveKey(workingKey: string): Buffer {
  return crypto.createHash("md5").update(workingKey, "utf8").digest();
}

/** Encrypt the merchant request payload (form-urlencoded string) → hex. */
export function encryptCCA(plaintext: string, workingKey: string): string {
  const key = deriveKey(workingKey);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, FIXED_IV);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString(
    "hex"
  );
}

/** Decrypt CCAvenue's encResp (hex) → form-urlencoded string. */
export function decryptCCA(ciphertextHex: string, workingKey: string): string {
  const key = deriveKey(workingKey);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, FIXED_IV);
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Build the redirect form payload that the browser will POST to CCAvenue.
 * Returns: { actionUrl, encRequest, accessCode } — render in a self-submitting
 * form so the browser is redirected to CCAvenue's hosted page.
 */
export function buildRedirectPayload(args: {
  orderId: string;
  amountRupees: number; // integer rupees (CCAvenue requires currency string)
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  billingAddress: {
    line1: string;
    city: string;
    state: string;
    pincode: string;
  };
}): { actionUrl: string; encRequest: string; accessCode: string } {
  const cfg = getCCAvenueConfig();
  const params = new URLSearchParams();
  params.set("merchant_id", cfg.merchantId);
  params.set("order_id", args.orderId);
  params.set("currency", "INR");
  params.set("amount", String(args.amountRupees));
  params.set("redirect_url", cfg.redirectUrl);
  params.set("cancel_url", cfg.cancelUrl);
  params.set("language", "EN");
  params.set("billing_name", args.customerName);
  params.set("billing_address", args.billingAddress.line1);
  params.set("billing_city", args.billingAddress.city);
  params.set("billing_state", args.billingAddress.state);
  params.set("billing_zip", args.billingAddress.pincode);
  params.set("billing_country", "India");
  params.set("billing_tel", args.customerPhone);
  params.set("billing_email", args.customerEmail);

  const encRequest = encryptCCA(params.toString(), cfg.workingKey);
  return {
    actionUrl: `${cfg.apiBase}/transaction/transaction.do?command=initiateTransaction`,
    encRequest,
    accessCode: cfg.accessCode,
  };
}

/**
 * Parse a CCAvenue callback. Returns the decoded fields after AES decryption.
 * Throws if decryption fails or the response is empty.
 */
export function parseCallback(encResp: string): Record<string, string> {
  const cfg = getCCAvenueConfig();
  const decoded = decryptCCA(encResp, cfg.workingKey);
  const params = new URLSearchParams(decoded);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Status API client
//
// CCAvenue's Gateway Settings API (Status / Order Lookup / Confirm /
// Refund) lives on a DIFFERENT subdomain than the hosted-payment
// redirect — `apitest.ccavenue.com` in UAT, `api.ccavenue.com` in
// production. The same `CCAVENUE_API_BASE` env that drives the
// transaction redirect (test.ccavenue.com / secure.ccavenue.com) does
// NOT serve the Status API path — hitting `/apis/servlet/DoWebTrans`
// against test.ccavenue.com returns 404. We derive the right host here.
//
//   POST ${statusApiBase}/apis/servlet/DoWebTrans
//   body (form-urlencoded):
//     enc_request   = AES-128-CBC(plaintext JSON, working_key)
//     access_code   = merchant access code
//     request_type  = "JSON"
//     response_type = "JSON"
//     command       = "orderStatusTracker"
//
// The response is also form-urlencoded with an `enc_response` field — same
// AES scheme, decode → JSON. If `status=1` is returned in plain text the
// outer enc_response is the unencrypted error message (we surface it).
// ────────────────────────────────────────────────────────────────────

/**
 * Map the transaction-redirect host to the corresponding Gateway Settings
 * API host. CCAvenue ships these on parallel-but-distinct hostnames:
 *
 *   transaction host        →  status / lookup / confirm / refund host
 *   ──────────────────────────────────────────────────────────────────
 *   test.ccavenue.com       →  apitest.ccavenue.com
 *   secure.ccavenue.com     →  api.ccavenue.com
 *   <anything else>         →  unchanged (let the caller override via env)
 *
 * Env override: `CCAVENUE_STATUS_API_BASE` short-circuits this entirely,
 * which is the escape hatch for self-hosted gateways or future host
 * renames CCAvenue might ship.
 */
function resolveStatusApiBase(apiBase: string): string {
  const override = process.env.CCAVENUE_STATUS_API_BASE?.replace(/\/+$/, "");
  if (override) return override;
  const trimmed = apiBase.replace(/\/+$/, "");
  if (/^https?:\/\/test\.ccavenue\.com$/i.test(trimmed)) {
    return trimmed.replace(/test\.ccavenue\.com$/i, "apitest.ccavenue.com");
  }
  if (/^https?:\/\/secure\.ccavenue\.com$/i.test(trimmed)) {
    return trimmed.replace(/secure\.ccavenue\.com$/i, "api.ccavenue.com");
  }
  return trimmed;
}

/** What our codebase consumes from CCAvenue's Status / callback response.
 *  Both the inline callback parser and the Status API client are normalised
 *  to this shape so `finalizeOrderPayment` doesn't care where the data
 *  came from. */
export type NormalizedGatewayResult = {
  /** Bucket the raw CCAvenue status into something we can act on. */
  status: "paid" | "failed" | "pending" | "unknown";
  /** CCAvenue's `reference_no` for the transaction. */
  trackingId: string | null;
  /** The bank's downstream reference (auth code / RRN-ish). */
  bankRef: string | null;
  /** Amount as the gateway recorded it. Free-text — we don't parse to
   *  paise here; callers preserve CCAvenue's format. */
  paidAmount: string | null;
  /** CCAvenue's free-text date string (e.g. "2026-04-13 10:59:53.217"). */
  paymentDate: string | null;
  /** "Credit Card" / "Net Banking" / etc. */
  paymentMode: string | null;
  /** CCAvenue's raw `order_status` field, kept for audit. */
  rawStatus: string;
  /** Entire decoded response object — stored as JSONB on the payment row
   *  for forensic debugging. */
  rawResponse: Record<string, unknown>;
};

/** Map CCAvenue's free-text status enum to our four buckets. Conservative
 *  for terminal-ish but ambiguous states (Refunded / Chargeback / System
 *  refund) — those return `unknown` so the poller never auto-undoes a
 *  refund that ops has already processed manually.
 *
 *  Accepts both enums CCAvenue ships: the Status API uses "Successful" /
 *  "Unsuccessful", while the hosted-redirect callback (`order_status` field
 *  on the form-encoded POST) uses "Success" / "Failure". Same mapper feeds
 *  both call sites — needs to recognise both. */
export function mapCCAvenueStatus(
  rawStatus: string
): NormalizedGatewayResult["status"] {
  const s = (rawStatus || "").trim().toLowerCase();
  if (s === "successful" || s === "success" || s === "shipped") return "paid";
  if (
    s === "aborted" ||
    s === "unsuccessful" ||
    s === "failure" ||
    s === "auto-cancelled" ||
    s === "cancelled" ||
    s === "invalid" ||
    s === "fraud"
  ) {
    return "failed";
  }
  if (s === "initiated" || s === "awaited" || s === "auto-reversed") {
    return "pending";
  }
  return "unknown";
}

type StatusApiArgs = {
  /** CCAvenue's own reference_no for the order, if we have it stored
   *  (payments.gateway_tracking_id). Either this or `orderNo` is required;
   *  CCAvenue accepts either. */
  referenceNo?: string | null;
  /** Our merchant order number (orders.order_number). Always available. */
  orderNo: string;
};

/**
 * One-shot status lookup against CCAvenue's Status API. Resilient:
 *  - HTTP / network errors → throws (caller treats as "still pending").
 *  - status=1 (gateway-level error like bad reference) → returns
 *    `{ status: 'unknown', rawStatus: '<message>', ... }` so callers can
 *    log the reason without exploding the cron run.
 *  - Successful decrypt → normalised + raw response preserved.
 */
export async function fetchCCAvenueOrderStatus(
  args: StatusApiArgs
): Promise<NormalizedGatewayResult> {
  if (!args.referenceNo && !args.orderNo) {
    throw new Error(
      "fetchCCAvenueOrderStatus: need at least one of referenceNo / orderNo"
    );
  }
  const cfg = getCCAvenueConfig();
  const statusApiBase = resolveStatusApiBase(cfg.apiBase);

  // CCAvenue issues a separate IP-bound access_code/working_key pair for
  // the server-to-server Status / Cancel / Refund APIs. It's tied to the
  // whitelisted outbound IP, not to a URL like the hosted-payment pair.
  // Fall back to the hosted-payment credentials when these aren't set so
  // single-pair merchant accounts keep working.
  const statusAccessCode =
    process.env.CCAVENUE_STATUS_ACCESS_CODE || cfg.accessCode;
  const statusWorkingKey =
    process.env.CCAVENUE_STATUS_WORKING_KEY || cfg.workingKey;

  // Plaintext body CCAvenue expects for the Status API. JSON is friendlier
  // than the pipe-separated STRING format for an English-readable codebase.
  const innerJson = JSON.stringify({
    reference_no: args.referenceNo ?? "",
    order_no: args.orderNo,
  });
  const encRequest = encryptCCA(innerJson, statusWorkingKey);

  const body = new URLSearchParams();
  body.set("enc_request", encRequest);
  body.set("access_code", statusAccessCode);
  body.set("request_type", "JSON");
  body.set("response_type", "JSON");
  body.set("command", "orderStatusTracker");

  const url = `${statusApiBase}/apis/servlet/DoWebTrans`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Short timeout — CCAvenue's Status API is fast; if it stalls beyond
    // a few seconds we'd rather fail the call and let the poller retry
    // than block a parent-facing request.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(
      `CCAvenue Status API HTTP ${res.status} ${res.statusText}`
    );
  }
  const text = await res.text();

  // Response shape: form-urlencoded "status=0&enc_response=<hex>" or, on
  // gateway-level errors, "status=1&enc_response=<plain error message>".
  const respParams = new URLSearchParams(text);
  const outerStatus = respParams.get("status");
  const encResponse = respParams.get("enc_response") ?? "";

  if (outerStatus === "1") {
    return {
      status: "unknown",
      trackingId: null,
      bankRef: null,
      paidAmount: null,
      paymentDate: null,
      paymentMode: null,
      rawStatus: encResponse || "CCAvenue status API returned status=1",
      rawResponse: { gatewayError: encResponse },
    };
  }

  let decoded: string;
  try {
    decoded = decryptCCA(encResponse, statusWorkingKey);
  } catch (e) {
    throw new Error(
      `CCAvenue Status API decrypt failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    // Decrypt succeeded but JSON didn't parse — surface raw payload for
    // forensic debugging without bringing the run down.
    return {
      status: "unknown",
      trackingId: null,
      bankRef: null,
      paidAmount: null,
      paymentDate: null,
      paymentMode: null,
      rawStatus: "non-JSON Status API response",
      rawResponse: { decoded },
    };
  }

  // CCAvenue's real-world JSON ships the order fields under an outer
  // `Order_Status_Result` envelope, not at the top level the way the
  // sample-response excerpt in their docs implies. Tolerate both: peel
  // the envelope when present, fall back to the flat shape otherwise.
  const envelope =
    typeof parsed.Order_Status_Result === "object" && parsed.Order_Status_Result !== null
      ? (parsed.Order_Status_Result as Record<string, unknown>)
      : parsed;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const num = (v: unknown): string | null =>
    typeof v === "number" ? String(v) : str(v);

  // Inner status=1 means CCAvenue accepted our request but had no record
  // to return (or some other application-level failure described by
  // `error_desc`). Don't try to map a missing order_status — just bubble
  // it up as 'unknown' so the finaliser leaves local state alone.
  const innerStatus = envelope.status;
  const errorDesc = str(envelope.error_desc);
  if (innerStatus === 1 || innerStatus === "1") {
    return {
      status: "unknown",
      trackingId: null,
      bankRef: null,
      paidAmount: null,
      paymentDate: null,
      paymentMode: null,
      rawStatus: errorDesc ?? "ccavenue_status_inner_1",
      rawResponse: parsed,
    };
  }

  const rawStatus = str(envelope.order_status) ?? "";
  return {
    status: mapCCAvenueStatus(rawStatus),
    trackingId: num(envelope.reference_no),
    bankRef: str(envelope.order_bank_ref_no),
    paidAmount: num(envelope.order_amt) ?? num(envelope.order_gross_amt),
    paymentDate: str(envelope.order_status_date_time) ?? str(envelope.order_date_time),
    paymentMode: str(envelope.order_card_name) ?? str(envelope.order_option_type),
    rawStatus,
    rawResponse: parsed,
  };
}

/**
 * Same normalised shape, derived from the form-urlencoded fields the
 * browser-redirect / webhook callback delivers. Keeps the callback route
 * symmetrical with the Status API result so `finalizeOrderPayment` only
 * has to understand `NormalizedGatewayResult`.
 */
export function normalizeCallbackPayload(
  fields: Record<string, string>
): NormalizedGatewayResult {
  const rawStatus = fields.order_status ?? "";
  return {
    status: mapCCAvenueStatus(rawStatus),
    trackingId: fields.tracking_id ?? fields.reference_no ?? null,
    bankRef: fields.bank_ref_no ?? null,
    paidAmount: fields.amount ?? null,
    paymentDate: fields.trans_date ?? null,
    paymentMode: fields.payment_mode ?? null,
    rawStatus,
    rawResponse: fields,
  };
}
