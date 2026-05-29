"use client";

import { useEffect, useState, useTransition } from "react";
import { Play, AlertTriangle, RefreshCw, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type RunRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "dead";
  payload: { trigger?: string };
  result: SyncResult | null;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

type SyncResult = {
  scanned: number;
  productsInserted: number;
  productsUpdated: number;
  variantsInserted: number;
  variantsUpdated: number;
  schoolsCreated: number;
  categoriesCreated: number;
  variantsLinked: number;
  variantsOrphaned: number;
  failed: number;
  errors: { erpName: string; message: string }[];
  durationMs: number;
};

type MediaRunRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "dead";
  result: MediaResult | null;
  lastError: string | null;
  createdAt: string;
};
type MediaResult = {
  scanned: number;
  mirrored: number;
  alreadyMirrored: number;
  skippedLocal: number;
  failed: number;
  bytesDownloaded: number;
  errors: { url: string; reason: string }[];
  durationMs: number;
};

export function ErpItemFeedSyncTrigger() {
  const [running, start] = useTransition();
  const [rehosting, startRehost] = useTransition();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [mediaRuns, setMediaRuns] = useState<MediaRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  async function loadRuns() {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/admin/erp/sync-items", { cache: "no-store" }),
        fetch("/api/admin/erp/rehost-images", { cache: "no-store" }),
      ]);
      if (r1.ok) setRuns((await r1.json()).runs ?? []);
      if (r2.ok) setMediaRuns((await r2.json()).runs ?? []);
      setLoadedAt(new Date());
    } catch {}
  }

  useEffect(() => {
    loadRuns();
    // Light polling while any run is in flight.
    const t = setInterval(() => {
      const anyRunning =
        runs.some((r) => r.status === "running" || r.status === "queued") ||
        mediaRuns.some((r) => r.status === "running" || r.status === "queued");
      if (anyRunning) loadRuns();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.length, mediaRuns.length, runs.some((r) => r.status === "running"), mediaRuns.some((r) => r.status === "running")]);

  const trigger = () => {
    if (
      !confirm(
        "Sync all items from audit.inventre.online now? Pulls the full feed (~6107 rows) and upserts. New rows land as 'draft'."
      )
    )
      return;
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/erp/sync-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Sync trigger failed");
        return;
      }
      if (data.alreadyRunning) {
        setError("Another sync is already running — wait for it to finish.");
      }
      loadRuns();
    });
  };

  const triggerRehost = () => {
    if (
      !confirm(
        "Mirror all ERP images into MinIO now? Walks every product image still pointing at the upstream ERP host and copies the bytes locally. Idempotent — already-mirrored files are skipped."
      )
    )
      return;
    setError(null);
    startRehost(async () => {
      const r = await fetch("/api/admin/erp/rehost-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Rehost trigger failed");
        return;
      }
      if (data.alreadyRunning) {
        setError("A rehost is already running — wait for it to finish.");
      }
      loadRuns();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          busy={running}
          icon={<Play className="h-3.5 w-3.5" />}
          onClick={trigger}
          type="button"
          variant="primary"
        >
          Sync items now
        </Button>
        <Button
          busy={rehosting}
          icon={<ImageIcon className="h-3.5 w-3.5" />}
          onClick={triggerRehost}
          type="button"
        >
          Mirror images into MinIO
        </Button>
        <button
          type="button"
          onClick={loadRuns}
          className="text-[12px] text-ink-500 hover:text-ink-700 inline-flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          {loadedAt ? `Refreshed ${loadedAt.toLocaleTimeString()}` : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="text-[13px] text-red-700 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      ) : null}

      <div>
        <h4 className="text-[13px] font-semibold text-ink-700 mb-2">Recent runs</h4>
        {runs.length === 0 ? (
          <p className="text-[12px] text-ink-500">No runs yet.</p>
        ) : (
          <div className="border border-ink-100/70 rounded-xl overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-cream-50/60 text-ink-600">
                <tr>
                  <th className="px-2 py-2 text-left">When</th>
                  <th className="px-2 py-2 text-left">Trigger</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Scanned</th>
                  <th className="px-2 py-2 text-right text-emerald-700">+Prod</th>
                  <th className="px-2 py-2 text-right text-sky-700">~Prod</th>
                  <th className="px-2 py-2 text-right text-emerald-700">+Var</th>
                  <th className="px-2 py-2 text-right">Schools</th>
                  <th className="px-2 py-2 text-right">Cats</th>
                  <th className="px-2 py-2 text-right text-red-700">Fail</th>
                  <th className="px-2 py-2 text-right">Dur</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-ink-100/70">
                    <td className="px-2 py-1.5 text-ink-500 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">{r.payload?.trigger ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          r.status === "completed"
                            ? "text-emerald-700"
                            : r.status === "running"
                              ? "text-sky-700"
                              : r.status === "failed"
                                ? "text-red-700"
                                : "text-ink-600"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.scanned ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.productsInserted ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.productsUpdated ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.variantsInserted ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.schoolsCreated ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.categoriesCreated ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.failed ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-500">
                      {r.result?.durationMs != null
                        ? `${(r.result.durationMs / 1000).toFixed(1)}s`
                        : r.status === "running"
                          ? "…"
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runs.some((r) => r.status === "failed" && r.lastError) ? (
          <div className="mt-2 text-[11px] text-red-700 max-h-24 overflow-y-auto">
            <strong>Last error:</strong>{" "}
            {runs.find((r) => r.status === "failed" && r.lastError)?.lastError}
          </div>
        ) : null}
      </div>

      {/* Image rehost runs */}
      <div>
        <h4 className="text-[13px] font-semibold text-ink-700 mb-2">
          Recent image-mirror runs
        </h4>
        {mediaRuns.length === 0 ? (
          <p className="text-[12px] text-ink-500">No image-mirror runs yet.</p>
        ) : (
          <div className="border border-ink-100/70 rounded-xl overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-cream-50/60 text-ink-600">
                <tr>
                  <th className="px-2 py-2 text-left">When</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Scanned</th>
                  <th className="px-2 py-2 text-right text-emerald-700">Mirrored</th>
                  <th className="px-2 py-2 text-right text-ink-500">Already</th>
                  <th className="px-2 py-2 text-right text-red-700">Failed</th>
                  <th className="px-2 py-2 text-right">Bytes</th>
                  <th className="px-2 py-2 text-right">Dur</th>
                </tr>
              </thead>
              <tbody>
                {mediaRuns.map((r) => (
                  <tr key={r.id} className="border-t border-ink-100/70">
                    <td className="px-2 py-1.5 text-ink-500 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          r.status === "completed"
                            ? "text-emerald-700"
                            : r.status === "running"
                              ? "text-sky-700"
                              : r.status === "failed"
                                ? "text-red-700"
                                : "text-ink-600"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.scanned ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.mirrored ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.alreadyMirrored ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.result?.failed ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-500">
                      {r.result?.bytesDownloaded != null
                        ? `${(r.result.bytesDownloaded / 1024 / 1024).toFixed(1)} MB`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-500">
                      {r.result?.durationMs != null
                        ? `${(r.result.durationMs / 1000).toFixed(1)}s`
                        : r.status === "running"
                          ? "…"
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
