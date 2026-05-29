"use client";

import { useState, useTransition } from "react";
import { Play, AlertTriangle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Summary = {
  doctype: string;
  total: number;
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: { row: number; reason: string }[];
};

export function ErpSyncTrigger() {
  const [running, start] = useTransition();
  const [results, setResults] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = () => {
    if (
      !confirm(
        "Pull all doctypes from ERPNext now? This is idempotent (safe to re-run) but may take several minutes."
      )
    )
      return;
    setError(null);
    setResults(null);
    start(async () => {
      const r = await fetch("/api/admin/erp/pull", { method: "POST" });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Pull failed");
        return;
      }
      setResults(data.summaries ?? []);
    });
  };

  return (
    <div className="space-y-4">
      <Button
        busy={running}
        icon={<Play className="h-3.5 w-3.5" />}
        onClick={trigger}
        type="button"
      >
        Pull from ERPNext now
      </Button>

      {error ? (
        <div className="text-[13px] text-red-700 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      ) : null}

      {results ? (
        <div className="border border-ink-100/70 rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50">
              <tr>
                <th className="px-3 py-2 text-left">Doctype</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right text-emerald-700">New</th>
                <th className="px-3 py-2 text-right text-sky-700">Updated</th>
                <th className="px-3 py-2 text-right text-ink-500">Skipped</th>
                <th className="px-3 py-2 text-right text-red-700">Errors</th>
              </tr>
            </thead>
            <tbody>
              {results.map((s) => (
                <tr key={s.doctype} className="border-t border-ink-100/70">
                  <td className="px-3 py-2 font-medium">{s.doctype}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.new}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.updated}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.skipped}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.some((s) => s.errors > 0) ? (
            <div className="px-3 py-2 bg-red-50/40 border-t border-ink-100/70 text-[12px]">
              <strong>Errors:</strong>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {results
                  .filter((s) => s.errorDetails.length)
                  .flatMap((s) =>
                    s.errorDetails.slice(0, 10).map((e) => (
                      <li key={`${s.doctype}-${e.row}`} className="text-red-700">
                        {s.doctype} row {e.row}: {e.reason}
                      </li>
                    ))
                  )}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
