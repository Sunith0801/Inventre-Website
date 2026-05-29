import "server-only";

/**
 * Single source of truth for every ERP-touching env var.
 *
 * Flip between staging and prod by changing one variable:
 *   ERP_TARGET=staging   →  reads STAGING_ERP_* vars
 *   ERP_TARGET=prod      →  reads PROD_ERP_* vars
 *
 * Backward-compat: if ERP_TARGET is unset but the legacy bare names are
 * (ERP_INGEST_URL etc.), those are used. This keeps existing envs working
 * until they're migrated.
 *
 * Nothing else in the codebase should read process.env.ERP_* directly —
 * import getErpConfig() instead. That's how the staging/prod switch stays
 * a one-variable change.
 */

export type ErpTarget = "staging" | "prod" | "legacy" | "unset";

export interface ErpConfig {
  /** Which env block is active. "unset" disables the bridge entirely. */
  target: ErpTarget;
  /** POST {ingestUrl} for order events. Empty string = bridge disabled. */
  ingestUrl: string;
  /** Base URL for read endpoints (poll worker). */
  apiBaseUrl: string;
  /** HMAC-SHA256 shared secret. Must match ERP's ECOM_WEBHOOK_SECRET. */
  webhookSecret: string;
  /** Service account for poll-side login. */
  pollUser: string;
  pollPass: string;
  /** Delay between enqueue and first drain attempt. */
  bufferDelaySeconds: number;
  /** Max queue rows processed per drain tick. Bounded so a flood doesn't run away. */
  drainChunkSize: number;
  /** Max attempts before a row is marked failed. */
  drainMaxAttempts: number;
  /** Parallel HTTP calls inside one drain tick. */
  drainConcurrency: number;
  /** Drain tick cadence (informational; the actual cron lives in /etc/cron.d). */
  drainIntervalSeconds: number;
  /** Poll cadence (informational). */
  pollIntervalSeconds: number;
  /** Parallel GETs inside one poll tick. */
  pollConcurrency: number;
  /** Stuck-`sending` recovery threshold. */
  stuckSendingSeconds: number;
  /** Shared secret for /api/cron/* endpoints. */
  cronToken: string;
}

function int(name: string, dflt: number): number {
  const v = process.env[name];
  if (!v) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function pick(targetKey: string, legacyKey: string): string {
  return process.env[targetKey] || process.env[legacyKey] || "";
}

/**
 * Resolve the active ERP config. Stateless — call freely; results are
 * derived from process.env each invocation so a config reload only needs
 * a process restart.
 *
 * Fail-loud rule: if ERP_TARGET is set to staging/prod but the matching
 * INGEST_URL is missing, throw. Silent fallback to the wrong target is
 * the worst possible outcome (writes to the wrong ERP).
 */
export function getErpConfig(): ErpConfig {
  const raw = (process.env.ERP_TARGET || "").toLowerCase().trim();
  const target: ErpTarget =
    raw === "staging"
      ? "staging"
      : raw === "prod" || raw === "production"
        ? "prod"
        : process.env.ERP_INGEST_URL
          ? "legacy"
          : "unset";

  const PREFIX =
    target === "staging" ? "STAGING_" : target === "prod" ? "PROD_" : "";

  // For staging/prod, read from <PREFIX>_ERP_*; for legacy, the bare names.
  const ingestUrl =
    target === "staging" || target === "prod"
      ? process.env[`${PREFIX}ERP_INGEST_URL`] || ""
      : process.env.ERP_INGEST_URL || "";

  if ((target === "staging" || target === "prod") && !ingestUrl) {
    throw new Error(
      `[erp-config] ERP_TARGET=${target} but ${PREFIX}ERP_INGEST_URL is not set. ` +
        `Set either the target's vars or unset ERP_TARGET to fall back to legacy ERP_INGEST_URL.`
    );
  }

  return {
    target,
    ingestUrl,
    apiBaseUrl:
      target === "staging" || target === "prod"
        ? pick(`${PREFIX}ERP_API_BASE_URL`, "ERP_API_BASE_URL")
        : process.env.ERP_API_BASE_URL || "",
    webhookSecret:
      target === "staging" || target === "prod"
        ? pick(`${PREFIX}ERP_WEBHOOK_SECRET`, "ERP_WEBHOOK_SECRET")
        : process.env.ERP_WEBHOOK_SECRET || "",
    pollUser:
      target === "staging" || target === "prod"
        ? pick(`${PREFIX}ERP_POLL_USER`, "ERP_POLL_USER")
        : process.env.ERP_POLL_USER || "",
    pollPass:
      target === "staging" || target === "prod"
        ? pick(`${PREFIX}ERP_POLL_PASS`, "ERP_POLL_PASS")
        : process.env.ERP_POLL_PASS || "",
    bufferDelaySeconds: int("ERP_BUFFER_DELAY_SECONDS", 180),
    drainChunkSize: int("ERP_DRAIN_CHUNK_SIZE", 50),
    drainMaxAttempts: int("ERP_DRAIN_MAX_ATTEMPTS", 5),
    drainConcurrency: int("ERP_DRAIN_CONCURRENCY", 5),
    drainIntervalSeconds: int("ERP_DRAIN_INTERVAL_SECONDS", 30),
    pollIntervalSeconds: int("ERP_POLL_INTERVAL_SECONDS", 60),
    pollConcurrency: int("ERP_POLL_CONCURRENCY", 5),
    stuckSendingSeconds: int("ERP_STUCK_SENDING_SECONDS", 90),
    cronToken: process.env.CRON_TOKEN || "",
  };
}

/** True if the push side (ingest) is configured. */
export function isErpBridgeConfigured(cfg: ErpConfig = getErpConfig()): boolean {
  return !!cfg.ingestUrl && !!cfg.webhookSecret;
}

/** True if the pull side (poll) is configured. */
export function isErpPollConfigured(cfg: ErpConfig = getErpConfig()): boolean {
  return !!cfg.apiBaseUrl && !!cfg.pollUser && !!cfg.pollPass;
}
