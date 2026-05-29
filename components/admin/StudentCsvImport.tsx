"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Check, AlertTriangle } from "lucide-react";

type Row = {
  studentName: string;
  parentName: string;
  parentPhone: string;
  class: string;
  section: string;
  enrollmentNumber: string;
  errors: string[];
};

const HEADER = [
  "studentName",
  "parentName",
  "parentPhone",
  "class",
  "section",
  "enrollmentNumber",
];

function parseCsv(text: string): { rows: Row[]; headerOk: boolean } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], headerOk: false };
  const header = lines[0].split(",").map((s) => s.trim());
  const headerOk = HEADER.every((h, i) => header[i] === h);
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((s) => s.trim());
    const r: Row = {
      studentName: cols[0] ?? "",
      parentName: cols[1] ?? "",
      parentPhone: cols[2]?.replace(/\D/g, "") ?? "",
      class: cols[3] ?? "",
      section: cols[4] ?? "",
      enrollmentNumber: cols[5] ?? "",
      errors: [],
    };
    if (!r.studentName) r.errors.push("Missing student name");
    if (!/^\d{10}$/.test(r.parentPhone))
      r.errors.push("Parent phone must be 10 digits");
    if (!r.class) r.errors.push("Missing class");
    out.push(r);
  }
  return { rows: out, headerOk };
}

export function StudentCsvImport({
  schools,
}: {
  schools: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [headerOk, setHeaderOk] = useState(true);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed.rows);
    setHeaderOk(parsed.headerOk);
    setResult(null);
    setError(null);
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const valid = rows.filter((r) => r.errors.length === 0);
      if (valid.length === 0) {
        setError("No valid rows to import");
        return;
      }
      const res = await fetch("/api/admin/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, rows: valid }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Import failed");
        return;
      }
      const data = await res.json();
      setResult({ inserted: data.inserted, skipped: data.skipped });
      setRows([]);
      router.refresh();
    });

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const errorCount = rows.length - validCount;

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <h3 className="font-display text-[14px] font-bold text-ink-900">
          Required CSV format
        </h3>
        <pre className="mt-3 rounded-lg bg-cream-100 p-3 text-[11px] font-mono text-ink-700 overflow-x-auto">
{`studentName,parentName,parentPhone,class,section,enrollmentNumber
Mahendra Teja,Teja Parent,9999999999,Grade 6,B,4455
Aparna Menon,Anita Menon,9888777666,Grade 5,A,1408`}
        </pre>
      </div>

      <label className="flex flex-col">
        <span className="text-[12px] font-semibold text-ink-700">
          Target school
        </span>
        <select
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          className="mt-1 max-w-md rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
        >
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block rounded-2xl border border-dashed border-ink-200 bg-white py-10 text-center cursor-pointer hover:border-brand transition-colors">
        <Upload className="mx-auto h-6 w-6 text-ink-500 mb-2" />
        <span className="text-[13px] font-semibold text-ink-700">
          Click to select CSV
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </label>

      {!headerOk && rows.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          ⚠ CSV header doesn&apos;t match. Expected:{" "}
          <code className="font-mono">{HEADER.join(",")}</code>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-ink-100 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink-900">
              Preview · {rows.length} rows ·{" "}
              <span className="text-emerald-600">{validCount} valid</span>
              {errorCount > 0 && (
                <>
                  {" · "}
                  <span className="text-red-600">{errorCount} with errors</span>
                </>
              )}
            </p>
            <button
              onClick={submit}
              disabled={pending || validCount === 0 || !schoolId}
              className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-5 h-9 text-[12px] font-bold hover:bg-brand-600 disabled:opacity-50"
            >
              {pending ? "Importing…" : `Import ${validCount} students`}
            </button>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500 bg-cream-100">
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Parent</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Enrol #</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="px-3 py-2 text-ink-900">{r.studentName}</td>
                  <td className="px-3 py-2 text-ink-700">{r.parentName}</td>
                  <td className="px-3 py-2 font-mono text-ink-700">
                    {r.parentPhone}
                  </td>
                  <td className="px-3 py-2 text-ink-700">{r.class}</td>
                  <td className="px-3 py-2 text-ink-700">{r.section}</td>
                  <td className="px-3 py-2 font-mono text-ink-700">
                    {r.enrollmentNumber}
                  </td>
                  <td className="px-3 py-2">
                    {r.errors.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <Check className="h-3 w-3" /> ok
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-red-600"
                        title={r.errors.join("; ")}
                      >
                        <AlertTriangle className="h-3 w-3" /> {r.errors[0]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-[14px] text-emerald-800">
          <p className="font-display font-bold">Import complete</p>
          <p className="mt-1">
            <span className="font-semibold">{result.inserted}</span> students
            inserted ·{" "}
            <span className="font-semibold">{result.skipped}</span> rows
            skipped (already existed)
          </p>
        </div>
      )}
    </div>
  );
}
