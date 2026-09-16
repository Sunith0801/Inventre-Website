import "server-only";
import { sql, count } from "drizzle-orm";
import { db } from "@/db/client";
import { redis } from "@/server/redis";
import { notificationRules, webhookEndpoints } from "@/db/schema";
import { getErpConfig, isErpBridgeConfigured, isErpPollConfigured } from "@/server/erp-config";
import { getQueueCounts } from "@/server/erp-drain";
import { getOtpToggles } from "@/server/otp-toggles";
import { countActiveSuperAdmins } from "@/server/repos/admin-users";

/**
 * One read of everything the System Configuration hub and the dashboard's
 * health strip show. Each probe is independent and fails soft — a Redis
 * that is down must show as "down", not take the settings page with it.
 *
 * The env checks mirror what actually sends: SMS goes through
 * server/notify/sms.ts (SMS_API_URL + SMS_USERNAME), email through
 * server/notify/email.ts (SMTP_HOST, else RESEND_API_KEY). Anything else
 * would report a channel as configured that never sends.
 */
export type Probe = "ok" | "warn" | "down" | "off";

export type SystemStatus = {
  db: Probe;
  redis: Probe;
  erp: { probe: Probe; target: string; bridge: boolean; poll: boolean; pending: number; failed: number; dlq: number };
  sms: { probe: Probe; configured: boolean; realSend: boolean };
  email: { probe: Probe; configured: boolean; realSend: boolean; via: "smtp" | "resend" | null };
  ccavenue: Probe;
  rules: { enabled: number; total: number };
  webhooks: { enabled: number; total: number; failing: number };
  superAdmins: number;
};

const TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((res) => setTimeout(() => res(fallback), TIMEOUT_MS)),
  ]);
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const [dbOk, redisOk, queue, toggles, rules, hooks, supers] = await Promise.all([
    withTimeout(db.execute(sql`SELECT 1`).then(() => true), false),
    withTimeout(redis.ping().then(() => true), false),
    withTimeout(getQueueCounts(), { pending: 0, sending: 0, sent: 0, failed: 0, cancelled: 0, dlq: 0 }),
    withTimeout(getOtpToggles(), { smsRealSend: true, emailRealSend: true }),
    withTimeout(
      db
        .select({ total: count(), enabled: sql<number>`count(*) filter (where ${notificationRules.enabled})::int` })
        .from(notificationRules)
        .then((r) => ({ total: Number(r[0]?.total ?? 0), enabled: Number(r[0]?.enabled ?? 0) })),
      { total: 0, enabled: 0 },
    ),
    withTimeout(
      db
        .select({
          total: count(),
          enabled: sql<number>`count(*) filter (where ${webhookEndpoints.enabled})::int`,
          failing: sql<number>`count(*) filter (where ${webhookEndpoints.enabled} and ${webhookEndpoints.lastStatus} >= 400)::int`,
        })
        .from(webhookEndpoints)
        .then((r) => ({
          total: Number(r[0]?.total ?? 0),
          enabled: Number(r[0]?.enabled ?? 0),
          failing: Number(r[0]?.failing ?? 0),
        })),
      { total: 0, enabled: 0, failing: 0 },
    ),
    withTimeout(countActiveSuperAdmins(), 0),
  ]);

  const cfg = getErpConfig();
  const bridge = isErpBridgeConfigured(cfg);
  const poll = isErpPollConfigured(cfg);
  const erpProbe: Probe = !bridge ? "off" : queue.dlq > 0 || queue.failed > 0 ? "warn" : "ok";

  const smsConfigured = !!(process.env.SMS_API_URL && process.env.SMS_USERNAME);
  const smtp = !!process.env.SMTP_HOST;
  const resend = !!process.env.RESEND_API_KEY;
  const emailConfigured = smtp || resend;

  const channel = (configured: boolean, realSend: boolean): Probe =>
    !configured ? "off" : !realSend ? "warn" : "ok";

  return {
    db: dbOk ? "ok" : "down",
    redis: redisOk ? "ok" : "down",
    erp: {
      probe: erpProbe,
      target: cfg.target,
      bridge,
      poll,
      pending: queue.pending + queue.sending,
      failed: queue.failed,
      dlq: queue.dlq,
    },
    sms: { probe: channel(smsConfigured, toggles.smsRealSend), configured: smsConfigured, realSend: toggles.smsRealSend },
    email: {
      probe: channel(emailConfigured, toggles.emailRealSend),
      configured: emailConfigured,
      realSend: toggles.emailRealSend,
      via: smtp ? "smtp" : resend ? "resend" : null,
    },
    ccavenue: process.env.CCAVENUE_ACCESS_CODE && process.env.CCAVENUE_WORKING_KEY ? "ok" : "off",
    rules,
    webhooks: hooks,
    superAdmins: supers,
  };
}
