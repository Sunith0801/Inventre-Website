"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

type SkipReason = string;
type ImportSummary = {
  checked: number;
  imported: number;
  skipped: number;
  failed: number;
  bySkipReason: Record<SkipReason, number>;
  failures: { erpName: string; reason: string }[];
};

/**
 * Triggers POST /api/admin/orders/import-from-erp. Two modes:
 *   - "by-name": one specific SAL-ORD-XXX, instant per-row fix.
 *   - "all":     bulk catch-up against the erp.sales_orders mirror,
 *                bounded by `limit` (default 100/run, max 2000).
 *
 * Result counts are rendered inline so admins can see what happened
 * without needing to inspect server logs.
 */
export function SyncFromErpButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"by-name" | "all">("by-name");
  const [erpName, setErpName] = useState("");
  const [limit, setLimit] = useState(100);
  const [since, setSince] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const run = () => {
    reset();
    startTransition(async () => {
      try {
        const body =
          mode === "by-name"
            ? { erpName: erpName.trim() }
            : {
                all: true as const,
                limit,
                ...(since ? { since } : {}),
              };
        const res = await fetch("/api/admin/orders/import-from-erp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(b?.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as ImportSummary;
        setResult(data);
        if (data.imported > 0) router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ink-200 bg-white text-ink-800 text-[13px] font-semibold hover:border-ink-900"
      >
        <Download className="h-3.5 w-3.5" />
        Sync from ERPNext
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center px-4"
          onClick={() => (pending ? null : setOpen(false))}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-bold text-ink-900">
              Import orders from ERPNext
            </h3>
            <p className="mt-1 text-[12px] text-ink-500 leading-snug">
              Pulls Sales Orders from ERPNext into the local DB so the admin
              panel becomes their authoritative home. Idempotent — re-running
              for already-imported orders is a no-op.
            </p>

            <div className="mt-4 flex gap-2">
              {(["by-name", "all"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    reset();
                  }}
                  className={
                    "px-3 h-8 rounded-md border text-[12px] font-semibold transition " +
                    (mode === m
                      ? "bg-ink-900 text-white border-ink-900"
                      : "border-ink-200 text-ink-700 hover:border-ink-900")
                  }
                >
                  {m === "by-name" ? "One order" : "Bulk"}
                </button>
              ))}
            </div>

            {mode === "by-name" && (
              <div className="mt-4">
                <label className="block text-[11px] font-semibold text-ink-500 mb-1">
                  ERPNext order name
                </label>
                <input
                  value={erpName}
                  onChange={(e) => setErpName(e.target.value)}
                  placeholder="SAL-ORD-2026-27076"
                  className="w-full h-9 px-3 rounded-md border border-ink-200 text-[13px] font-mono"
                />
              </div>
            )}
            {mode === "all" && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-ink-500 mb-1">
                    Limit (max 2000)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value) || 100)}
                    className="w-full h-9 px-3 rounded-md border border-ink-200 text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-ink-500 mb-1">
                    Since (YYYY-MM-DD, optional)
                  </label>
                  <input
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                    placeholder="2026-01-01"
                    className="w-full h-9 px-3 rounded-md border border-ink-200 text-[13px] font-mono"
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="h-9 px-3 rounded-md text-[13px] font-medium text-ink-500 hover:text-ink-900"
              >
                Close
              </button>
              <button
                type="button"
                onClick={run}
                disabled={pending || (mode === "by-name" && !erpName.trim())}
                className="h-9 px-4 rounded-md bg-ink-900 text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {pending ? "Importing…" : "Import"}
              </button>
            </div>

            {error && (
              <p className="mt-3 text-[12px] text-rose-700">{error}</p>
            )}

            {result && (
              <div className="mt-4 rounded-lg border border-ink-100 bg-cream-50 p-3">
                <p className="text-[12px] font-semibold text-ink-900">
                  Result: {result.imported} imported · {result.skipped} skipped · {result.failed} failed
                </p>
                {Object.entries(result.bySkipReason).length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-ink-600">
                    {Object.entries(result.bySkipReason).map(([k, v]) => (
                      <li key={k}>
                        skipped — {k}: {v}
                      </li>
                    ))}
                  </ul>
                )}
                {result.failures.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[11px] font-semibold text-rose-700 cursor-pointer">
                      {result.failures.length} failure{result.failures.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-rose-700">
                      {result.failures.slice(0, 8).map((f) => (
                        <li key={f.erpName}>
                          <span className="font-mono">{f.erpName}</span> — {f.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
