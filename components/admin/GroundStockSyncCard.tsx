"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Badge, Card, CardHeader } from "@/components/admin/ui/primitives";

type Run = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  trigger: string;
  rowsFetched: number;
  itemCodes: number;
  matched: number;
  unmatched: number;
  changed: number;
  cleared: number;
  error: string | null;
  unmatchedSample: string[] | null;
};

type Status = {
  runs: Run[];
  tracked: number;
  inStock: number;
  soldOut: number;
  lastSync: string | null;
  lastOkAt: string | null;
  gate: { enabled: boolean; unmatched: "out_of_stock" | "available" };
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never";

/**
 * Ground Stock bridge — status, "Sync now", and the storefront gate.
 * Lives on /admin/reports/stock next to the bin totals it feeds.
 */
export function GroundStockSyncCard() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const load = async () => {
    try {
      const res = await fetch("/api/admin/stock/ground-sync", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as Status);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load status");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const post = (body: Record<string, unknown>) =>
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/stock/ground-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `status ${res.status}`);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "request failed");
      }
      await load();
      router.refresh();
    });

  const last = status?.runs[0] ?? null;
  const gate = status?.gate;

  return (
    <Card padded={false}>
      <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3 flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          title="Ground Stock bridge"
          description="Audit ERP Ground Stock → these bins → storefront availability. Runs every 5 minutes."
        />
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          busy={busy}
          onClick={() => post({ action: "run" })}
        >
          Sync now
        </Button>
      </div>

      <div className="px-5 lg:px-6 pb-4 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-[13px]">
        <div>
          <div className="text-ink-500">Last successful sync</div>
          <div className="font-medium">{fmt(status?.lastOkAt ?? null)}</div>
        </div>
        <div>
          <div className="text-ink-500">SKUs tracked by the audit</div>
          <div className="font-medium">
            {status?.tracked ?? "—"}{" "}
            <span className="text-ink-500 font-normal">
              ({status?.inStock ?? 0} in stock · {status?.soldOut ?? 0} sold out)
            </span>
          </div>
        </div>
        <div>
          <div className="text-ink-500">Last run</div>
          <div className="font-medium flex items-center gap-2">
            {last ? (
              <>
                <Badge tone={last.ok ? "success" : "danger"} dot size="sm">
                  {last.ok ? "ok" : "failed"}
                </Badge>
                <span className="text-ink-500 font-normal">
                  {last.matched} matched · {last.changed} changed · {last.unmatched} unmatched
                </span>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div>
          <div className="text-ink-500">Storefront rule</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 font-medium">
              <input
                id="ground-gate-enabled"
                type="checkbox"
                checked={gate?.enabled ?? true}
                disabled={!gate || busy}
                onChange={(e) =>
                  post({ action: "gate", enabled: e.target.checked, unmatched: gate?.unmatched ?? "out_of_stock" })
                }
              />
              Ground Stock decides availability
            </label>
            <label className="inline-flex items-center gap-1.5 text-ink-500">
              uncounted garments
              <select
                id="ground-gate-unmatched"
                className="border rounded px-1 py-0.5 text-[12px]"
                value={gate?.unmatched ?? "out_of_stock"}
                disabled={!gate || busy || gate.enabled === false}
                onChange={(e) =>
                  post({ action: "gate", enabled: gate?.enabled ?? true, unmatched: e.target.value })
                }
              >
                <option value="out_of_stock">sold out</option>
                <option value="available">sellable</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {(error || last?.error) && (
        <div className="px-5 lg:px-6 pb-4 text-[12px] text-red-700">
          {error ?? last?.error}
        </div>
      )}

      {last?.unmatchedSample && last.unmatchedSample.length > 0 && (
        <details className="px-5 lg:px-6 pb-5 text-[12px]">
          <summary className="cursor-pointer text-ink-500">
            {last.unmatched} audit item codes with no storefront SKU (first {last.unmatchedSample.length})
          </summary>
          <div className="mt-2 font-mono flex flex-wrap gap-x-4 gap-y-1">
            {last.unmatchedSample.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
