"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/admin/ui/primitives-client";

type RawRow = Record<string, string>;
type RowError = { row: number; message: string; data?: unknown };
type ImportResult = {
  inserted: number;
  skipped: number;
  failed: number;
  errors: RowError[];
};

const REQUIRED_HEADERS = [
  "schoolCode",
  "enrollmentNumber",
  "firstName",
  "grade",
  "guardianName",
  "guardianMobile",
] as const;

const OPTIONAL_HEADERS = [
  "middleName",
  "lastName",
  "section",
  "gender",
  "studentEmail",
  "studentMobile",
  "dateOfBirth",
  "guardianEmail",
  "guardianRelation",
] as const;

const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

export function BulkImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const missingHeaders = useMemo(() => {
    if (rows.length === 0) return [];
    const first = rows[0];
    return REQUIRED_HEADERS.filter((h) => !(h in first));
  }, [rows]);

  async function onPick(file: File) {
    setParseError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Empty workbook");
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
      });
      // Coerce every cell to trimmed string so the API gets predictable types.
      const normalized: RawRow[] = parsed.map((r) => {
        const out: RawRow = {};
        for (const [k, v] of Object.entries(r)) {
          out[k.trim()] = v == null ? "" : String(v).trim();
        }
        return out;
      });
      setRows(normalized);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not read the file");
      setRows([]);
    }
  }

  async function onSubmit() {
    if (rows.length === 0 || missingHeaders.length > 0) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = (await r.json()) as ImportResult | { error: string };
      if (!r.ok) {
        setParseError(
          "error" in data ? data.error : "Import failed — check the console"
        );
        return;
      }
      setResult(data as ImportResult);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/students"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to students
      </Link>

      {/* ── Step 1: download template ────────────────────────────── */}
      <section>
        <h3 className="text-[14px] font-semibold text-ink-900">
          1. Download the template
        </h3>
        <p className="mt-1 text-[13px] text-ink-600">
          Fill one row per student. Save as CSV or .xlsx and upload below.
        </p>
        <div className="mt-3">
          <a
            href="/api/admin/students/import/template"
            download
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] font-semibold text-ink-800 hover:border-ink-900 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download CSV template
          </a>
        </div>
        <details className="mt-3 text-[12.5px] text-ink-600">
          <summary className="cursor-pointer font-semibold text-ink-800">
            Column reference
          </summary>
          <ul className="mt-2 space-y-1 list-disc pl-5">
            {ALL_HEADERS.map((h) => (
              <li key={h}>
                <code className="font-mono text-[11.5px]">{h}</code>
                {REQUIRED_HEADERS.includes(h as never) && (
                  <span className="ml-2 text-red-600 font-semibold">required</span>
                )}
                {h === "schoolCode" && <span className="ml-2 text-ink-500">— e.g. SMSAW, KLINK, SAMYU</span>}
                {h === "grade" && <span className="ml-2 text-ink-500">— type the actual grade (Nursery, LKG, UKG, Grade 1 – Grade 12). No conversion is applied; the cell is stored verbatim.</span>}
                {h === "guardianMobile" && <span className="ml-2 text-ink-500">— 10 digits, spaces / +91 / dashes are stripped</span>}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <hr className="border-ink-100" />

      {/* ── Step 2: upload + preview ─────────────────────────────── */}
      <section>
        <h3 className="text-[14px] font-semibold text-ink-900">2. Upload the filled file</h3>
        <p className="mt-1 text-[13px] text-ink-600">
          CSV or Excel (.xlsx). Up to 2,000 rows per upload. The file is
          parsed in your browser — nothing is sent to the server until you
          click Import.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] font-semibold text-ink-800 hover:border-ink-900 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Choose file
          </button>
          {fileName && (
            <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-600">
              <FileSpreadsheet className="h-4 w-4 text-ink-400" />
              {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {parseError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}

        {missingHeaders.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Missing required column{missingHeaders.length === 1 ? "" : "s"}:{" "}
              <code className="font-mono">{missingHeaders.join(", ")}</code>.
              Re-download the template and keep all the headers in row 1.
            </span>
          </div>
        )}
      </section>

      {/* ── Preview ──────────────────────────────────────────────── */}
      {rows.length > 0 && missingHeaders.length === 0 && (
        <section>
          <h3 className="text-[14px] font-semibold text-ink-900">
            3. Preview (first 10 rows)
          </h3>
          <div className="mt-3 overflow-x-auto rounded-lg border border-ink-100">
            <table className="w-full text-[12px]">
              <thead className="bg-ink-50 text-left">
                <tr>
                  <th className="px-2 py-1.5 font-semibold text-ink-700">#</th>
                  {ALL_HEADERS.map((h) => (
                    <th key={h} className="px-2 py-1.5 font-semibold text-ink-700 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-ink-100">
                    <td className="px-2 py-1.5 font-mono text-ink-500">{i + 2}</td>
                    {ALL_HEADERS.map((h) => (
                      <td key={h} className="px-2 py-1.5 text-ink-800 whitespace-nowrap">
                        {r[h] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 10 && (
            <p className="mt-2 text-[12px] text-ink-500">
              … and {rows.length - 10} more row{rows.length - 10 === 1 ? "" : "s"}
            </p>
          )}

          <div className="mt-4">
            <Button
              variant="primary"
              disabled={busy}
              onClick={onSubmit}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {busy ? "Importing…" : `Import ${rows.length} student${rows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </section>
      )}

      {/* ── Result ──────────────────────────────────────────────── */}
      {result && (
        <section>
          <h3 className="text-[14px] font-semibold text-ink-900">Result</h3>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Inserted" value={result.inserted} colour="text-emerald-700" />
            <Stat label="Skipped (duplicate)" value={result.skipped} colour="text-amber-700" />
            <Stat label="Failed" value={result.failed} colour="text-red-700" />
          </div>
          {result.inserted > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                {result.inserted} student{result.inserted === 1 ? "" : "s"} inserted.
                Parents can sign in now — first sign-in triggers OTP + set-password.
              </span>
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-semibold text-red-700 mb-2">
                Errors ({result.failed})
              </p>
              <ul className="space-y-1 text-[12px] text-ink-700 max-h-64 overflow-y-auto border border-ink-100 rounded-lg p-3">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono text-ink-500">Row {e.row}</span>{" "}
                    — {e.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-ink-500">
                Fix the failed rows in your sheet and re-upload only those — successful
                rows from this run will be skipped as duplicates.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="rounded-lg border border-ink-100 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">{label}</p>
      <p className={`mt-0.5 font-display text-[22px] font-bold ${colour}`}>{value}</p>
    </div>
  );
}
