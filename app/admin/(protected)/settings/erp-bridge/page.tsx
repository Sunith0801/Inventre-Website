import { desc, eq, sql } from "drizzle-orm";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
} from "@/components/admin/ui/primitives";
import { db } from "@/db/client";
import { webhookDeliveries, webhookEndpoints, erpOutboundQueue } from "@/db/schema";
import { ReplayButton } from "./replay-button";
import { SendNowButton } from "./send-now-button";
import { getErpConfig, isErpBridgeConfigured, isErpPollConfigured } from "@/server/erp-config";
import { getQueueCounts } from "@/server/erp-drain";
import { getSyncStateRows } from "@/server/erp-poll";

export const dynamic = "force-dynamic";

type MirrorCount = { table: string; rows: number };

async function getMirrorCounts(): Promise<MirrorCount[]> {
  const tables = [
    "customers",
    "items",
    "sales_orders",
    "sales_order_items",
    "sales_order_sub_items",
    "sales_order_payment_schedule",
    "outward_shipments",
    "outward_status_events",
    "packing_units",
  ];
  const out: MirrorCount[] = [];
  for (const t of tables) {
    try {
      const r: any = await db.execute(
        sql.raw(`SELECT COUNT(*)::int AS n FROM erp.${t}`)
      );
      const rows = r.rows ?? r;
      out.push({ table: t, rows: Number(rows[0]?.n ?? 0) });
    } catch {
      out.push({ table: t, rows: -1 });
    }
  }
  return out;
}

async function pingErp(): Promise<{ ok: boolean; status: number; body: string }> {
  const cfg = getErpConfig();
  if (!cfg.ingestUrl) return { ok: false, status: 0, body: "ingest URL not set" };
  // Swap the /ingest tail for /healthz on the same host.
  const healthz = cfg.ingestUrl.replace(/\/ingest\/?$/, "/healthz");
  try {
    const res = await fetch(healthz, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : "unreachable" };
  }
}

export default async function ErpBridgePage() {
  const cfg = getErpConfig();
  const configured = isErpBridgeConfigured(cfg);
  const pollConfigured = isErpPollConfigured(cfg);

  const [endpoint] = configured
    ? await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.name, "erp-bridge"))
        .limit(1)
    : [null as any];

  const deliveries = endpoint
    ? await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, endpoint.id))
        .orderBy(desc(webhookDeliveries.id))
        .limit(50)
    : [];

  const [mirror, healthz, queueCounts, queueRows, syncState] = await Promise.all([
    getMirrorCounts(),
    pingErp(),
    getQueueCounts(),
    db
      .select()
      .from(erpOutboundQueue)
      .orderBy(desc(erpOutboundQueue.enqueuedAt))
      .limit(25),
    getSyncStateRows(),
  ]);

  const totalSent = deliveries.length;
  const totalOk = deliveries.filter((d) => d.status && d.status >= 200 && d.status < 300).length;
  const totalErr = deliveries.filter((d) => d.status && d.status >= 400).length;

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        breadcrumb={[
          { label: "Settings", href: "/admin/settings" },
          { label: "ERP bridge (live)" },
        ]}
        eyebrow="Settings"
        title="ERP bridge"
        description="Bidirectional integration with the ERP ops app. ECOM → ERP sends signed events on order create / payment confirm / cancel. ERP → ECOM mirrors warehouse state into erp.* in real time."
      />

      {/* Health summary */}
      <section>
        <Card>
          <CardHeader title="Health" description="Right now, this minute." />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric
              label="ECOM → ERP"
              value={configured ? "WIRED" : "UNCONFIGURED"}
              tone={configured ? "success" : "danger"}
            />
            <Metric
              label="ERP /healthz"
              value={healthz.ok ? `OK (${healthz.status})` : `DOWN`}
              tone={healthz.ok ? "success" : "danger"}
              hint={healthz.ok ? healthz.body.slice(0, 80) : healthz.body.slice(0, 80)}
            />
            <Metric
              label="Last 50 deliveries"
              value={`${totalOk} OK / ${totalErr} fail / ${totalSent} total`}
              tone={totalErr === 0 && totalSent > 0 ? "success" : totalErr > 0 ? "warning" : "neutral"}
            />
            <Metric
              label="Last delivery"
              value={
                endpoint?.lastStatus
                  ? `${endpoint.lastStatus} @ ${endpoint.lastDeliveryAt?.toISOString().slice(11, 19) ?? "?"}`
                  : "—"
              }
              tone={
                !endpoint?.lastStatus
                  ? "neutral"
                  : endpoint.lastStatus >= 200 && endpoint.lastStatus < 300
                    ? "success"
                    : "danger"
              }
              hint={endpoint?.lastError ?? undefined}
            />
          </div>
        </Card>
      </section>

      {/* Config */}
      <section>
        <Card>
          <CardHeader
            title="Configuration"
            description={`Active target: ${cfg.target.toUpperCase()} — switch via ERP_TARGET env var.`}
          />
          <Row label="Ingest URL" value={cfg.ingestUrl ? "configured" : "missing"} hint={cfg.ingestUrl || "Set <TARGET>_ERP_INGEST_URL"} />
          <Row label="Webhook secret" value={cfg.webhookSecret ? "configured" : "missing"} hint={cfg.webhookSecret ? "(hidden — must match ERP's ECOM_WEBHOOK_SECRET)" : "Set <TARGET>_ERP_WEBHOOK_SECRET"} />
          <Row label="API base URL (poll)" value={cfg.apiBaseUrl ? "configured" : "missing"} hint={cfg.apiBaseUrl || "Set <TARGET>_ERP_API_BASE_URL"} />
          <Row label="Poll credentials" value={pollConfigured ? "configured" : "missing"} hint={pollConfigured ? `user ${cfg.pollUser}` : "Set <TARGET>_ERP_POLL_USER/PASS"} />
          <Row label="Cron token" value={cfg.cronToken ? "configured" : "missing"} hint={cfg.cronToken ? "(hidden — used by /api/cron/erp-drain & /api/cron/erp-poll)" : "Set CRON_TOKEN"} />
          <Row label="Buffer delay" value="configured" hint={`${cfg.bufferDelaySeconds}s before drain picks up a new queue row`} />
          <Row label="Endpoint row" value={endpoint ? "configured" : "missing"} hint={endpoint ? `${endpoint.events.join(", ")}` : "auto-created on first emit"} />
        </Card>
      </section>

      {/* Outbound queue (buffer between checkout and ERP) */}
      <section>
        <Card>
          <CardHeader
            title="Outbound queue (buffer)"
            description={`Checkout writes here first. The drain worker POSTs to ERP after ${cfg.bufferDelaySeconds}s. Failed rows surface here for replay.`}
          />
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <Metric label="Pending"   value={String(queueCounts.pending)}   tone={queueCounts.pending > 0 ? "warning" : "neutral"} />
            <Metric label="Sending"   value={String(queueCounts.sending)}   tone={queueCounts.sending > 0 ? "warning" : "neutral"} />
            <Metric label="Sent"      value={String(queueCounts.sent)}      tone="success" />
            <Metric label="Failed"    value={String(queueCounts.failed)}    tone={queueCounts.failed > 0 ? "danger" : "neutral"} />
            <Metric label="Cancelled" value={String(queueCounts.cancelled)} tone="neutral" />
            <Metric label="DLQ"       value={String(queueCounts.dlq)}       tone={queueCounts.dlq > 0 ? "danger" : "neutral"} hint="erp_outbound_dlq permanent failures" />
          </div>
          {queueRows.length === 0 ? (
            <p className="text-[13px] text-ink-600">Queue is empty.</p>
          ) : (
            <div className="overflow-x-auto -mx-3">
              <table className="min-w-full text-[12px]">
                <thead className="text-left text-ink-600 border-b border-ink-100">
                  <tr>
                    <th className="px-3 py-2">Enqueued</th>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Scheduled</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Last error</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {queueRows.map((q) => {
                    const tone: "success" | "danger" | "warning" | "subtle" | "info" =
                      q.status === "sent" ? "success"
                      : q.status === "failed" ? "danger"
                      : q.status === "sending" ? "warning"
                      : q.status === "cancelled" ? "subtle" : "info";
                    return (
                      <tr key={q.id} className="border-b border-ink-50 last:border-0">
                        <td className="px-3 py-2 text-ink-700 whitespace-nowrap">
                          {q.enqueuedAt.toISOString().slice(0, 19).replace("T", " ")}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-ink-600">
                          {q.orderId.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2 font-mono">{q.eventType}</td>
                        <td className="px-3 py-2">
                          <Badge tone={tone as never} dot size="sm">{q.status}</Badge>
                        </td>
                        <td className="px-3 py-2 text-ink-600 whitespace-nowrap">
                          {q.scheduledFor.toISOString().slice(0, 19).replace("T", " ")}
                        </td>
                        <td className="px-3 py-2 text-ink-600 text-right">{q.attempts}</td>
                        <td className="px-3 py-2 text-ink-500 max-w-[260px] truncate font-mono">
                          {q.lastError?.slice(0, 80) ?? ""}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {q.status === "pending" ? (
                            <SendNowButton queueId={q.id} variant="send" />
                          ) : q.status === "failed" ? (
                            <SendNowButton queueId={q.id} variant="retry" />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* ERP → ECOM mirror counts */}
      <section>
        <Card>
          <CardHeader
            title="ERP → ECOM mirror (erp.* schema)"
            description="Counts under the erp.* schema in this database. The ERP publisher upserts these every ~5 seconds; reconciler tops up nightly. -1 = table missing on ecom side."
          />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[12px]">
            {mirror.map((m) => (
              <div
                key={m.table}
                className="flex items-center justify-between rounded border border-ink-100 px-3 py-2"
              >
                <code className="font-mono text-ink-700">erp.{m.table}</code>
                <span className={m.rows < 0 ? "text-rose-600 font-semibold" : "text-ink-900 font-semibold"}>
                  {m.rows < 0 ? "MISSING" : m.rows.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Delta-sync watermarks (Phase 1b) */}
      <section>
        <Card>
          <CardHeader
            title="Delta-sync watermarks"
            description="One watermark per resource pulled from ERP. The poller fetches rows modified after the watermark, upserts mirrors, then advances. Lag = now − last_modified_seen."
          />
          {syncState.length === 0 ? (
            <p className="text-[13px] text-ink-600">
              erp.sync_state has no rows yet. The first poll tick will seed them.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-3">
              <table className="min-w-full text-[12px]">
                <thead className="text-left text-ink-600 border-b border-ink-100">
                  <tr>
                    <th className="px-3 py-2">Resource</th>
                    <th className="px-3 py-2">Last modified seen</th>
                    <th className="px-3 py-2">Lag</th>
                    <th className="px-3 py-2">Last run</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Rows last run</th>
                    <th className="px-3 py-2 text-right">Total synced</th>
                    <th className="px-3 py-2">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {syncState.map((s) => {
                    const tone: "success" | "danger" | "warning" | "subtle" =
                      s.last_run_status === "ok" ? "success"
                      : s.last_run_status === "error" ? "danger"
                      : !s.last_run_at ? "subtle" : "warning";
                    const lagLabel =
                      s.lag_seconds === null
                        ? "—"
                        : s.lag_seconds < 120
                          ? `${s.lag_seconds}s`
                          : s.lag_seconds < 7200
                            ? `${Math.round(s.lag_seconds / 60)}m`
                            : `${Math.round(s.lag_seconds / 3600)}h`;
                    return (
                      <tr key={s.resource} className="border-b border-ink-50 last:border-0">
                        <td className="px-3 py-2 font-mono text-ink-700">{s.resource}</td>
                        <td className="px-3 py-2 text-ink-600 whitespace-nowrap">
                          {s.last_modified_seen?.slice(0, 19).replace("T", " ") ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-900 font-semibold">{lagLabel}</td>
                        <td className="px-3 py-2 text-ink-600 whitespace-nowrap">
                          {s.last_run_at?.slice(0, 19).replace("T", " ") ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={tone as never} dot size="sm">
                            {s.last_run_status ?? "never"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right text-ink-700">
                          {s.rows_synced_last_run.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-ink-700">
                          {s.rows_synced_total.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-ink-500 max-w-[260px] truncate font-mono">
                          {s.last_error?.slice(0, 100) ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* Recent deliveries */}
      <section>
        <Card>
          <CardHeader
            title="Recent webhook deliveries"
            description="Latest 50 events the ecom app POSTed at the ERP ingest endpoint. Click Resend to replay the same envelope."
          />
          {deliveries.length === 0 ? (
            <p className="text-[13px] text-ink-600">
              Nothing yet. Place a test order on the storefront — a row will appear here within a second.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-3">
              <table className="min-w-full text-[12px]">
                <thead className="text-left text-ink-600 border-b border-ink-100">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Aggregate</th>
                    <th className="px-3 py-2">Seq</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Response</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => {
                    const env: any = d.payload;
                    const ok = d.status && d.status >= 200 && d.status < 300;
                    return (
                      <tr key={d.id} className="border-b border-ink-50 last:border-0">
                        <td className="px-3 py-2 text-ink-700 whitespace-nowrap">
                          {d.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                        </td>
                        <td className="px-3 py-2 font-mono">{d.event}</td>
                        <td className="px-3 py-2 font-mono text-ink-600">
                          {String(env?.aggregate ?? "").slice(0, 22)}
                        </td>
                        <td className="px-3 py-2 text-ink-600 text-right">{env?.seq ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge tone={ok ? "success" : d.status === 0 ? "warning" : "danger"} dot size="sm">
                            {d.status ?? "pending"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-ink-500 max-w-[280px] truncate font-mono">
                          {d.responseBody?.slice(0, 80) ?? ""}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ReplayButton deliveryId={d.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: "configured" | "missing";
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-ink-100/70 last:border-0">
      <div>
        <div className="text-[13px] font-medium text-ink-900 font-mono">{label}</div>
        {hint ? (
          <div className="text-[11px] text-ink-500 mt-0.5 break-all">{hint}</div>
        ) : null}
      </div>
      <Badge tone={value === "configured" ? "success" : "danger"} dot size="sm">
        {value === "configured" ? "Configured" : "Missing"}
      </Badge>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const ring = {
    success: "ring-emerald-200 bg-emerald-50",
    warning: "ring-amber-200 bg-amber-50",
    danger: "ring-rose-200 bg-rose-50",
    neutral: "ring-ink-100 bg-ink-50",
  }[tone];
  return (
    <div className={`rounded-md ring-1 px-3 py-2 ${ring}`}>
      <div className="text-[11px] uppercase tracking-wide text-ink-600">{label}</div>
      <div className="text-[14px] font-semibold mt-0.5">{value}</div>
      {hint ? <div className="text-[11px] text-ink-500 mt-0.5 truncate">{hint}</div> : null}
    </div>
  );
}
