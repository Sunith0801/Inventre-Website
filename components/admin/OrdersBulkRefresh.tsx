"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Check, AlertTriangle, X } from "lucide-react";
import { Badge, Td, Tr } from "@/components/admin/ui/primitives";

export type OrdersRow = {
  erp_name: string;
  customer: string | null;
  transaction_date: string | null;
  delivery_date: string | null;
  status: string | null;
  grand_total: number;
  per_delivered: number;
  per_billed: number;
  local_id: string | null;
  school_name: string | null;
  enrollment_number: string | null;
  grade: string | null;
  ordered_at: string | null;
  cca_tracking_id: string | null;
  cca_order_id: string | null;
  payment_status: string | null;
  gateway_response_message: string | null;
  status_bucket: string | null;
};

/** Extract the raw CCAvenue status word from a forensic message like
 *  `CCAvenue 2026-05-28T12:30:21.397Z: status=No Record Found bankRef=…`.
 *  Returns null if the message doesn't carry a status= segment. */
function extractCcaStatus(msg: string | null): string | null {
  if (!msg) return null;
  const m = msg.match(/status=([^\s][^]*?)(?:\s+bankRef=|$)/);
  return m ? m[1].trim() : null;
}

const inr = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN") : "—";
const fmtIst = (ts: string | null) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

function statusTone(status: string | null): "success" | "info" | "warning" | "danger" | "default" {
  if (!status) return "default";
  const s = status.toLowerCase();
  if (s === "paid" || s === "delivered" || s === "shipped" || s === "successful" || s === "confirmed")
    return "success";
  if (s === "to deliver" || s === "to deliver and bill") return "info";
  if (s === "pending" || s === "placed" || s === "awaited" || s === "initiated") return "warning";
  if (
    s === "failed" ||
    s === "cancelled" ||
    s === "returned" ||
    s === "unsuccessful" ||
    s === "aborted" ||
    s === "aborted by customer"
  )
    return "danger";
  return "default";
}

/** Bucket → human label shown on the Status column. */
function bucketLabel(bucket: string | null): string | null {
  if (!bucket) return null;
  if (bucket === "confirmed") return "Confirmed";
  if (bucket === "pending") return "Pending";
  if (bucket === "aborted") return "Aborted by Customer";
  if (bucket === "failed") return "Failed";
  if (bucket === "refunded") return "Refunded";
  return null;
}

function paymentStatusTone(status: string | null): "success" | "warning" | "danger" | "violet" | "default" {
  if (!status) return "default";
  const s = status.toLowerCase();
  if (s === "paid" || s === "successful" || s === "shipped") return "success";
  if (s === "pending" || s === "initiated" || s === "awaited" || s === "auto-reversed") return "warning";
  if (
    s === "failed" ||
    s === "unsuccessful" ||
    s === "failure" ||
    s === "aborted" ||
    s === "cancelled" ||
    s === "auto-cancelled" ||
    s === "invalid" ||
    s === "fraud" ||
    s === "no record found"
  )
    return "danger";
  if (s === "refunded" || s === "system refund" || s === "chargeback") return "violet";
  return "default";
}

type RefreshResult = {
  orderNumber: string;
  ok: boolean;
  trackingId?: string | null;
  rawStatus?: string;
  status?: string;
  error?: string;
};

/**
 * Owns the per-row selection state + the bulk CCAvenue refresh action.
 *
 * Top of the table: a sticky toolbar shows up the moment any row is
 * selected. Click "Refresh N from CCAvenue" → POSTs the selected
 * order_numbers to /api/admin/orders/bulk-refresh-cca, which fires the
 * Status API in parallel (concurrency = 10 on the server) and writes
 * results back. The toolbar then surfaces a compact per-order outcome
 * summary so ops can spot the ones that didn't move.
 *
 * Page navigation / search-filter resets the selection (page is a server
 * component; each navigation produces a fresh instance of this client
 * island).
 */
export function OrdersBulkRefresh({
  rows,
}: {
  rows: OrdersRow[];
  /** Reserved for future bulk-delete / force-finalise actions that
   *  require the super role. Currently unused — the CCAvenue refresh is
   *  allowed for ops too, so no gating needed. */
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RefreshResult[] | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.erp_name));
  const someSelected = selected.size > 0;

  function togglePageAll() {
    if (allOnPageSelected) {
      const remaining = new Set(selected);
      for (const r of rows) remaining.delete(r.erp_name);
      setSelected(remaining);
    } else {
      const next = new Set(selected);
      for (const r of rows) next.add(r.erp_name);
      setSelected(next);
    }
  }

  function toggleOne(erp: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(erp)) next.delete(erp);
      else next.add(erp);
      return next;
    });
  }

  async function refreshSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setResults(null);
    setStartedAt(Date.now());
    setElapsedMs(null);
    try {
      const r = await fetch("/api/admin/orders/bulk-refresh-cca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumbers: Array.from(selected) }),
      });
      const data = (await r.json().catch(() => null)) as
        | { results: RefreshResult[]; summary?: { ok: number; withTracking: number; errored: number } }
        | { error: string }
        | null;
      if (!r.ok || !data || "error" in data) {
        setResults([
          {
            orderNumber: "—",
            ok: false,
            error: (data && "error" in data ? data.error : null) ?? `HTTP ${r.status}`,
          },
        ]);
      } else {
        setResults(data.results);
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setResults([
        { orderNumber: "—", ok: false, error: e instanceof Error ? e.message : "Network error" },
      ]);
    } finally {
      setBusy(false);
      setElapsedMs(startedAt ? Date.now() - startedAt : null);
    }
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const trackingCount = results?.filter((r) => r.ok && r.trackingId).length ?? 0;
  const erroredCount = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <>
      {someSelected ? (
        <div className="sticky top-0 z-20 -mx-px mb-2 rounded-lg border border-brand-200 bg-brand-50/95 backdrop-blur px-4 py-2.5 shadow-sm flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold text-brand-800">
            {selected.size} order{selected.size === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            onClick={refreshSelected}
            disabled={busy}
            className={
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold " +
              (busy
                ? "bg-ink-200 text-ink-500 cursor-wait"
                : "bg-brand-600 text-white hover:bg-brand-700")
            }
          >
            <RefreshCw className={"h-3.5 w-3.5 " + (busy ? "animate-spin" : "")} />
            {busy ? `Refreshing… (${selected.size})` : `Refresh ${selected.size} from CCAvenue`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2.5 py-1 text-[12px] text-ink-700 hover:bg-cream-50"
          >
            <X className="h-3 w-3" /> Clear
          </button>
          {results ? (
            <div className="ml-auto flex items-center gap-3 text-[12px]">
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="h-3 w-3" /> {okCount} ok
              </span>
              <span className="text-brand-800 font-mono">
                {trackingCount} tracking IDs
              </span>
              {erroredCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <AlertTriangle className="h-3 w-3" /> {erroredCount} errored
                </span>
              ) : null}
              {elapsedMs !== null ? (
                <span className="text-ink-500">in {(elapsedMs / 1000).toFixed(1)}s</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <table className="w-full border-collapse">
        <thead className="bg-gradient-to-r from-brand-50 via-cream-50 to-brand-50 border-b border-ink-200">
          <tr>
            <th className="px-3 py-3 w-8 text-left">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={togglePageAll}
                aria-label="Select all rows on this page"
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              />
            </th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Order #</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">CCAvenue Ref</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Customer</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">School</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Enrolment</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Grade</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Ordered (IST)</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Delivery</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Status</th>
            <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Payment</th>
            <th className="px-3 py-3 text-right text-[12px] font-bold uppercase tracking-wider text-ink-800">Delivered %</th>
            <th className="px-3 py-3 text-right text-[12px] font-bold uppercase tracking-wider text-ink-800">Grand total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const result = results?.find((res) => res.orderNumber === r.erp_name);
            const newTracking = result?.ok ? result.trackingId : null;
            return (
              <Tr key={r.erp_name}>
                <Td>
                  <input
                    type="checkbox"
                    checked={selected.has(r.erp_name)}
                    onChange={() => toggleOne(r.erp_name)}
                    aria-label={`Select ${r.erp_name}`}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                </Td>
                <Td>
                  <Link
                    href={`/admin/orders/${encodeURIComponent(r.erp_name)}`}
                    className="font-mono text-[13px] font-bold text-ink-900 hover:text-brand-700 hover:underline"
                  >
                    {r.erp_name}
                  </Link>
                </Td>
                <Td muted>
                  {newTracking ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-emerald-700 font-semibold">
                      <Check className="h-3 w-3" /> {newTracking}
                    </span>
                  ) : result && !result.ok ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-red-600" title={result.error}>
                      <AlertTriangle className="h-3 w-3" /> error
                    </span>
                  ) : r.cca_tracking_id ? (
                    <span className="font-mono text-[11.5px] text-ink-800">{r.cca_tracking_id}</span>
                  ) : r.cca_order_id ? (
                    <span
                      className="font-mono text-[11px] text-ink-400"
                      title="Tracking ID not yet populated — showing gateway order ID"
                    >
                      {r.cca_order_id}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </Td>
                <Td>
                  <span className="font-semibold text-ink-900">{r.customer ?? "—"}</span>
                </Td>
                <Td muted>
                  <span className="text-[12px]">{r.school_name ?? "—"}</span>
                </Td>
                <Td muted>
                  <span className="font-mono text-[11.5px]">{r.enrollment_number ?? "—"}</span>
                </Td>
                <Td muted>{r.grade ?? "—"}</Td>
                <Td muted>
                  <span className="text-[12px] tabular-nums whitespace-nowrap">{fmtIst(r.ordered_at)}</span>
                </Td>
                <Td muted>{fmt(r.delivery_date)}</Td>
                <Td>
                  {(() => {
                    // Status column shows the bucketed display label
                    // (Confirmed / Pending / Aborted by Customer /
                    // Failed). Falls back to the raw ERP status for
                    // mirror + legacy rows that have no local payment.
                    const label = bucketLabel(r.status_bucket) ?? r.status ?? "—";
                    return (
                      <Badge size="sm" tone={statusTone(label)}>
                        {label}
                      </Badge>
                    );
                  })()}
                </Td>
                <Td>
                  {(() => {
                    // Payment column shows the raw CCAvenue status text
                    // (Initiated / Awaited / Aborted / Successful / No
                    // Record Found / …) that the reconcile cron + the
                    // Refresh button persist. For finalised orders (paid
                    // / failed / refunded) — where no further CCAvenue
                    // poll happens — fall back to the local payment_status.
                    const raw = extractCcaStatus(r.gateway_response_message);
                    const label = raw ?? r.payment_status;
                    if (!label) return <span className="text-ink-300 text-[11px]">—</span>;
                    return (
                      <Badge size="sm" tone={paymentStatusTone(label)}>
                        {label}
                      </Badge>
                    );
                  })()}
                </Td>
                <Td right>
                  <span className="tabular-nums">{Math.round(Number(r.per_delivered))}%</span>
                </Td>
                <Td right>
                  <span className="font-semibold tabular-nums">{inr(r.grand_total)}</span>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
