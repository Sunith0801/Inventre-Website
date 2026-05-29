"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Copy, Download, X, Check, AlertTriangle, Printer } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";
import { bulkGenerateCoupons } from "./actions";

type SchoolOption = { erpName: string; name: string };

export function BulkGenerateDialog({ schools }: { schools: SchoolOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        icon={<Sparkles className="h-3.5 w-3.5" />}
        onClick={() => setOpen(true)}
      >
        Bulk generate
      </Button>
      {open ? <Modal schools={schools} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Modal({
  schools,
  onClose,
}: {
  schools: SchoolOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedSchools, setSelectedSchools] = useState<Set<string>>(new Set());
  const [universal, setUniversal] = useState(true);
  const [discount, setDiscount] = useState("100");
  const [startDt, setStartDt] = useState(toLocalInput(new Date()));
  const [endDt, setEndDt] = useState(toLocalInput(addDays(new Date(), 30)));
  const [quantity, setQuantity] = useState("10");
  const [oneTimeUse, setOneTimeUse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; codes: string[]; created: number }
    | { ok: false; error: string }
    | null
  >(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleSchool = (erpName: string) =>
    setSelectedSchools((cur) => {
      const next = new Set(cur);
      if (next.has(erpName)) next.delete(erpName);
      else next.add(erpName);
      return next;
    });

  async function apply() {
    setResult(null);
    setBusy(true);
    try {
      const r = await bulkGenerateCoupons({
        schoolErpNames: universal ? null : Array.from(selectedSchools),
        discount: Number(discount),
        startDatetime: startDt ? new Date(startDt).toISOString() : null,
        endDatetime: endDt ? new Date(endDt).toISOString() : null,
        quantity: Number(quantity),
        oneTimeUse,
      });
      setResult(r);
      if (r.ok) startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-ink-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-700" />
            <h2 className="text-[14px] font-bold text-ink-900">
              Bulk-generate coupon codes
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-ink-500" />
          </button>
        </div>

        {!result?.ok ? (
          <div className="p-5 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[12px] font-semibold text-ink-700">
                  Scope
                </label>
              </div>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setUniversal(true)}
                  className={chip(universal)}
                >
                  Universal (all schools)
                </button>
                <button
                  type="button"
                  onClick={() => setUniversal(false)}
                  className={chip(!universal)}
                >
                  Specific schools
                </button>
              </div>
              {!universal ? (
                <div className="max-h-[160px] overflow-y-auto rounded-lg border border-ink-200 p-2 space-y-1">
                  {schools.length === 0 ? (
                    <p className="text-[12px] text-ink-500 p-2">No schools.</p>
                  ) : (
                    schools.map((s) => (
                      <label
                        key={s.erpName}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-cream-50 cursor-pointer text-[12.5px]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSchools.has(s.erpName)}
                          onChange={() => toggleSchool(s.erpName)}
                          className="h-4 w-4 rounded border-ink-300"
                        />
                        <span>{s.name}</span>
                        <span className="ml-auto font-mono text-[10.5px] text-ink-400">
                          {s.erpName}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
              <p className="text-[11.5px] text-ink-500 mt-1.5">
                {universal
                  ? "Codes will work for parents of any school."
                  : `${selectedSchools.size} school${selectedSchools.size === 1 ? "" : "s"} selected — each gets ${quantity || 0} codes minted (total ${(Number(quantity) || 0) * selectedSchools.size}).`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Discount (₹)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Quantity per school">
                <input
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Valid from">
                <input
                  type="datetime-local"
                  value={startDt}
                  onChange={(e) => setStartDt(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Valid until">
                <input
                  type="datetime-local"
                  value={endDt}
                  onChange={(e) => setEndDt(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Code shape">
                <div className="h-9 inline-flex items-center px-2 rounded-lg bg-cream-50/60 border border-ink-200 font-mono text-[12.5px] text-ink-700">
                  INV + 6 random chars · no I/L/O/0/1
                </div>
              </Field>
              <Field label=" ">
                <label className="inline-flex items-center gap-2 text-[13px] text-ink-700 h-9">
                  <input
                    type="checkbox"
                    checked={oneTimeUse}
                    onChange={(e) => setOneTimeUse(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  One-time use (consumed only on payment success)
                </label>
              </Field>
            </div>

            {result && !result.ok ? (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700 text-[12.5px] inline-flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" /> {result.error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={apply}
                disabled={
                  busy ||
                  (!universal && selectedSchools.size === 0) ||
                  !quantity ||
                  Number(quantity) < 1
                }
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                {busy ? "Generating…" : "Generate codes"}
              </Button>
            </div>
          </div>
        ) : (
          <SuccessPanel codes={result.codes} created={result.created} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function SuccessPanel({
  codes,
  created,
  onClose,
}: {
  codes: string[];
  created: number;
  onClose: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const text = codes.join("\n");

  function downloadCsv() {
    const blob = new Blob(["coupon_code\n" + text + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coupons-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard() {
    if (taRef.current) {
      taRef.current.select();
      navigator.clipboard.writeText(text).catch(() => {
        document.execCommand?.("copy");
      });
    }
  }

  function printSheet() {
    const w = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!w) return;
    const rows = codes
      .map(
        (c, i) =>
          `<tr><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:#666;font-family:sans-serif">${i + 1}</td><td style="padding:6px 10px;border:1px solid #ddd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;letter-spacing:0.5px">${c}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><title>Coupon codes (${codes.length})</title><meta charset="utf-8"><style>
      @page { size: A4; margin: 18mm; }
      body { font-family: ui-sans-serif, system-ui, sans-serif; color:#111; }
      h1 { font-size: 16px; margin: 0 0 4px; }
      .meta { color:#555; font-size:12px; margin-bottom:14px; }
      table { border-collapse: collapse; width:100%; }
      th { background:#f6f6f6; padding:6px 10px; border:1px solid #ddd; text-align:left; font-size:12px; }
      @media print { .noprint { display:none; } button { display:none; } }
    </style></head><body>
      <h1>Inventre coupon codes</h1>
      <div class="meta">${codes.length} code${codes.length === 1 ? "" : "s"} · generated ${new Date().toLocaleString("en-IN")}</div>
      <div class="noprint" style="margin:8px 0 14px;"><button onclick="window.print()" style="padding:6px 12px;border:1px solid #999;border-radius:6px;cursor:pointer">Print / Save as PDF</button></div>
      <table><thead><tr><th>#</th><th>Code</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="p-5 space-y-3">
      <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 text-[12.5px]">
        <Check className="h-3.5 w-3.5" /> {created} coupon{created === 1 ? "" : "s"} created
      </div>
      <textarea
        ref={taRef}
        readOnly
        value={text}
        className="w-full h-[260px] rounded-lg border border-ink-200 p-2.5 font-mono text-[12.5px] bg-cream-50/50"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={copyToClipboard}
          >
            Copy all
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={downloadCsv}
          >
            Download CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<Printer className="h-3.5 w-3.5" />}
            onClick={printSheet}
          >
            Print / PDF
          </Button>
        </div>
        <Button type="button" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700 block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

const input =
  "w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white";

const chip = (active: boolean) =>
  "flex-1 h-9 rounded-lg text-[13px] font-semibold border " +
  (active
    ? "border-brand-500 bg-brand-100 text-brand-800"
    : "border-ink-200 bg-white text-ink-700 hover:bg-cream-50");

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
