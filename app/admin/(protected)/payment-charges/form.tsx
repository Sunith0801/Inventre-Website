"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PaymentChargesConfig } from "@/lib/payment-charges";

type Props = { initial: PaymentChargesConfig };

export function PaymentChargesForm({ initial }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [rows, setRows] = useState(initial.rows);
  const [footnote, setFootnote] = useState(initial.footnote);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const updateRow = (i: number, patch: Partial<{ label: string; rate: string }>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((rs) => [...rs, { label: "", rate: "" }]);
  const removeRow = (i: number) =>
    setRows((rs) => rs.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/settings/payment-charges", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, intro, rows, footnote }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? "Saved" : `Failed: ${j.error ?? r.status}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Field
        label="Heading"
        value={title}
        onChange={setTitle}
        placeholder="Payment-gateway charges apply"
      />
      <Field
        label="Intro line"
        value={intro}
        onChange={setIntro}
        placeholder="The transaction fee depends on the payment method you choose on the next page:"
        multiline
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-ink-700">
            Per-method rates
          </span>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-[12px] font-semibold text-ink-700 hover:border-ink-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add row
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={r.label}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="Method name (e.g. Credit Card)"
                className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-[13px] text-ink-900 outline-none focus:border-ink-900"
              />
              <input
                type="text"
                value={r.rate}
                onChange={(e) => updateRow(i, { rate: e.target.value })}
                placeholder="1.95%"
                className="w-24 rounded-lg border border-ink-200 px-3 py-2 text-[13px] text-ink-900 font-mono outline-none focus:border-ink-900"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length <= 1}
                title={rows.length <= 1 ? "At least one row required" : "Remove row"}
                className="rounded-lg border border-ink-200 p-2 text-ink-500 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Field
        label="Footnote"
        value={footnote}
        onChange={setFootnote}
        placeholder="18% GST is applied on the total amount…"
        multiline
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg ? <span className="text-[12px] text-ink-500">{msg}</span> : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[13px] text-ink-900 outline-none focus:border-ink-900 transition-colors leading-relaxed"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[13px] text-ink-900 outline-none focus:border-ink-900 transition-colors"
        />
      )}
    </label>
  );
}
