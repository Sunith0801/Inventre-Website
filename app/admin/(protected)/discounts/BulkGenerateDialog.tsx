"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Copy, Download, Check, AlertTriangle, Printer } from "lucide-react";
import { Button, Checkbox, Field, FormGrid, Input, Textarea } from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";
import { cn } from "@/lib/cn";
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
      {open ? <GenerateDialog schools={schools} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function GenerateDialog({ schools, onClose }: { schools: SchoolOption[]; onClose: () => void }) {
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
    { ok: true; codes: string[]; created: number } | { ok: false; error: string } | null
  >(null);

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

  const total = (Number(quantity) || 0) * (universal ? 1 : selectedSchools.size);
  const canGenerate = !busy && (universal || selectedSchools.size > 0) && Number(quantity) >= 1;

  if (result?.ok) {
    return <SuccessDialog codes={result.codes} created={result.created} onClose={onClose} />;
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Bulk-generate coupon codes"
      description="Mint a batch of fixed-amount codes in one go. Codes look like INV + 6 characters, with no I, L, O, 0 or 1 to misread."
      busy={busy}
      width="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={apply}
            busy={busy}
            disabled={!canGenerate}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            {total > 0 ? `Generate ${total} code${total === 1 ? "" : "s"}` : "Generate"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Scope">
          <div className="grid grid-cols-2 gap-2">
            <ScopeChip active={universal} onClick={() => setUniversal(true)} title="All schools" hint="Codes work for any parent." />
            <ScopeChip active={!universal} onClick={() => setUniversal(false)} title="Specific schools" hint="Each school gets its own batch." />
          </div>
          {!universal ? (
            <div className="mt-3 max-h-44 overflow-y-auto rounded-xl border border-ink-100/70 divide-y divide-ink-100/70">
              {schools.length === 0 ? (
                <p className="p-3 text-[12.5px] text-ink-500">No active schools.</p>
              ) : (
                schools.map((s) => (
                  <label
                    key={s.erpName}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-cream-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSchools.has(s.erpName)}
                      onChange={() => toggleSchool(s.erpName)}
                      className="h-4 w-4 rounded border-ink-200 accent-brand"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{s.name}</span>
                    <span className="font-mono text-[11px] text-ink-400">{s.erpName}</span>
                  </label>
                ))
              )}
            </div>
          ) : null}
        </Field>

        <FormGrid>
          <Field label="Discount (₹)" htmlFor="bg-discount" required>
            <Input id="bg-discount" type="number" step="0.01" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label={universal ? "Quantity" : "Quantity per school"} htmlFor="bg-qty" required>
            <Input id="bg-qty" type="number" min="1" max="1000" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Valid from" htmlFor="bg-start">
            <Input id="bg-start" type="datetime-local" value={startDt} onChange={(e) => setStartDt(e.target.value)} />
          </Field>
          <Field label="Valid until" htmlFor="bg-end">
            <Input id="bg-end" type="datetime-local" value={endDt} onChange={(e) => setEndDt(e.target.value)} />
          </Field>
        </FormGrid>

        <Checkbox
          checked={oneTimeUse}
          onChange={(e) => setOneTimeUse(e.target.checked)}
          label="One-time use"
          hint="Each code is consumed on its first successful payment."
        />

        {result && !result.ok ? (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {result.error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function ScopeChip({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-brand-500 bg-brand-50 ring-2 ring-brand/30"
          : "border-ink-100 bg-white hover:border-ink-300"
      )}
    >
      <span className="block text-[13px] font-semibold text-ink-900">{title}</span>
      <span className="block text-[11.5px] text-ink-500">{hint}</span>
    </button>
  );
}

function SuccessDialog({ codes, created, onClose }: { codes: string[]; created: number; onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
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
    taRef.current?.select();
    navigator.clipboard
      .writeText(text)
      .catch(() => document.execCommand?.("copy"))
      .finally(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
  }

  function printSheet() {
    const w = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!w) return;
    const rows = codes
      .map(
        (c, i) =>
          `<tr><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:#666">${i + 1}</td><td style="padding:6px 10px;border:1px solid #ddd;font-size:14px;letter-spacing:0.5px">${c}</td></tr>`,
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
    <Dialog
      open
      onClose={onClose}
      title={`${created} coupon${created === 1 ? "" : "s"} created`}
      description="Copy, download or print the codes now — they are also listed on the Discounts page."
      width="md"
      footer={
        <>
          <Button type="button" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={copyToClipboard}>
            {copied ? "Copied" : "Copy all"}
          </Button>
          <Button type="button" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={downloadCsv}>
            CSV
          </Button>
          <Button type="button" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={printSheet}>
            Print / PDF
          </Button>
          <Button type="button" onClick={onClose} icon={<Check className="h-3.5 w-3.5" />}>
            Done
          </Button>
        </>
      }
    >
      <Textarea ref={taRef} readOnly value={text} rows={10} className="font-mono bg-cream-50/50" />
    </Dialog>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
