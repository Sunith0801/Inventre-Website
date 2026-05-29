"use client";

import { useState, useRef } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  X,
  Sparkles,
} from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  Button,
  Badge,
  Stat,
} from "@/components/admin/ui/primitives";
import { cn } from "@/lib/cn";

type Preview = {
  filename: string;
  fileSize: number;
  headers: string[];
  totalRows: number;
  sample: Record<string, unknown>[];
  detectedDoctype: string | null;
  availableDoctypes: string[];
};

type Summary = {
  doctype: string;
  total: number;
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: { row: number; reason: string }[];
};

export default function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [doctype, setDoctype] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const onFile = async (f: File) => {
    setFile(f);
    setSummary(null);
    setError(null);
    const fd = new FormData();
    fd.append("file", f);
    setBusy(true);
    const r = await fetch("/api/admin/import/preview", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) {
      const e = await r.json();
      setError(e.error ?? "preview failed");
      setPreview(null);
      return;
    }
    const data = (await r.json()) as Preview;
    setPreview(data);
    setDoctype(data.detectedDoctype ?? "");
  };

  const apply = async (dryRun: boolean) => {
    if (!file || !doctype) return;
    setBusy(true);
    setSummary(null);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doctype", doctype);
    if (dryRun) fd.append("dryRun", "1");
    const r = await fetch("/api/admin/import/apply", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) {
      const e = await r.json();
      setError(e.error ?? "apply failed");
      return;
    }
    setSummary(await r.json());
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSummary(null);
    setError(null);
    setDoctype("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <PageHeader
        eyebrow="Tools"
        title="Import CSV / Excel"
        description="Drop a file exported from ERPNext. Auto-detects the DocType from filename + headers, previews the rows, and upserts using the same idempotent logic as the migration scripts."
      />

      {/* Dropzone */}
      <Card padded={false} className="mb-5 overflow-hidden">
        <label
          htmlFor="import-file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const f = e.dataTransfer.files[0];
            if (f) onFile(f);
          }}
          className={cn(
            "block cursor-pointer transition-colors px-8 py-12 text-center",
            dragActive ? "bg-brand-50" : "bg-gradient-to-b from-cream-50 to-white",
            file ? "py-7" : ""
          )}
        >
          <input
            ref={inputRef}
            id="import-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />

          {!file ? (
            <>
              <div className="grid h-14 w-14 mx-auto place-items-center rounded-2xl bg-white border border-ink-100/70 shadow-[0_1px_2px_rgba(10,10,10,0.04)]">
                <UploadCloud className="h-7 w-7 text-brand-600" />
              </div>
              <p className="mt-4 text-[15px] font-semibold text-ink-900">
                Drop a CSV or XLSX here, or click to browse
              </p>
              <p className="mt-1 text-[13px] text-ink-500 max-w-md mx-auto">
                Customer · Item · Item Price · Bin · Address · Sales Invoice
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between gap-4 max-w-3xl mx-auto">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-ink-900 text-[14px]">{file.name}</div>
                  <div className="text-[11px] text-ink-500">
                    {(file.size / 1024).toFixed(1)} KB ·{" "}
                    {preview?.totalRows.toLocaleString("en-IN") ?? "—"} rows
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  reset();
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-cream-100 hover:text-ink-900"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </label>
      </Card>

      {error ? (
        <div className="mb-5 border border-red-200 bg-red-50 text-red-800 p-3 rounded-xl flex gap-2 items-start text-[13px]">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
            <Stat
              label="Total rows"
              value={preview.totalRows.toLocaleString("en-IN")}
              iconTone="default"
            />
            <div className="rounded-2xl border border-ink-100/70 bg-white p-4 lg:p-5">
              <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
                Detected DocType
              </div>
              <div className="mt-2 flex items-center gap-2">
                {preview.detectedDoctype ? (
                  <>
                    <Sparkles className="h-4 w-4 text-brand-600" />
                    <span className="text-[20px] font-bold tracking-tight">
                      {preview.detectedDoctype}
                    </span>
                  </>
                ) : (
                  <Badge tone="warning" dot>
                    No match — pick manually
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-ink-100/70 bg-white p-4 lg:p-5">
              <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-2">
                Override
              </div>
              <select
                value={doctype}
                onChange={(e) => setDoctype(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-ink-200 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40 focus:border-ink-300 transition"
              >
                <option value="">— pick DocType —</option>
                {preview.availableDoctypes.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Card padded={false} className="mb-5">
            <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
              <CardHeader
                title="Preview"
                description={`First ${preview.sample.length} rows · ${preview.headers.length} columns`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="text-[12px] min-w-full">
                <thead>
                  <tr>
                    {preview.headers.map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-semibold text-[10px] tracking-[0.06em] uppercase text-ink-500 bg-cream-50/50 sticky top-0"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, i) => (
                    <tr key={i} className="border-t border-ink-100/60 hover:bg-cream-50/50">
                      {preview.headers.map((h) => (
                        <td
                          key={h}
                          className="px-3 py-2 max-w-[200px] truncate text-ink-700"
                          title={String(row[h] ?? "")}
                        >
                          {String(row[h] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center gap-2">
            <Button onClick={() => apply(true)} disabled={busy || !doctype} variant="secondary">
              Dry run (count only)
            </Button>
            <Button onClick={() => apply(false)} busy={busy} disabled={!doctype} variant="primary">
              {busy ? "Importing…" : "Apply import"}
            </Button>
          </div>
        </>
      ) : null}

      {summary ? (
        <Card className="mt-6 border-emerald-200/70 bg-gradient-to-b from-emerald-50/50 to-white">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-ink-900">Import done</h3>
              <p className="text-[12px] text-ink-500">{summary.doctype}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
            <Stat label="Total" value={summary.total} iconTone="default" />
            <Stat label="New" value={summary.new} iconTone="success" />
            <Stat label="Updated" value={summary.updated} iconTone="info" />
            <Stat label="Skipped" value={summary.skipped} iconTone="warning" />
            <Stat
              label="Errors"
              value={summary.errors}
              iconTone={summary.errors > 0 ? "danger" : "default"}
            />
          </div>

          {summary.errorDetails.length > 0 ? (
            <details className="mt-5 rounded-xl bg-white border border-ink-100/70 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-ink-900">
                {summary.errorDetails.length} issue
                {summary.errorDetails.length > 1 ? "s" : ""} — click to expand
              </summary>
              <ul className="mt-3 space-y-1.5 text-[12px] max-h-[300px] overflow-auto">
                {summary.errorDetails.map((d, i) => (
                  <li key={i} className="text-ink-600">
                    <span className="font-mono text-ink-400">Row {d.row}</span> · {d.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
