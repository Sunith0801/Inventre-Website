"use client";

import { useState } from "react";
import { Check, Plus, Save, Trash2 } from "lucide-react";
import type { PaymentChargesConfig } from "@/server/payment-charges";
import { Button, Card, Field, Input, Textarea, FormError, Th } from "@/components/admin/ui/primitives";

type Props = { initial: PaymentChargesConfig };

/**
 * The fee-schedule editor. Left: the text and the per-method rates. Right:
 * the notice exactly as a parent reads it on the checkout page, updated as
 * you type — the copy is customer-facing, so what it will look like matters
 * more than the fields themselves.
 */
export function PaymentChargesForm({ initial }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [rows, setRows] = useState(initial.rows);
  const [footnote, setFootnote] = useState(initial.footnote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const touch = () => setSaved(false);
  const updateRow = (i: number, patch: Partial<{ label: string; rate: string }>) => {
    touch();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    touch();
    setRows((rs) => [...rs, { label: "", rate: "" }]);
  };
  const removeRow = (i: number) => {
    touch();
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/settings/payment-charges", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, intro, rows, footnote }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Could not save (${r.status}).`);
        return;
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error — nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card padded={false} className="overflow-hidden">
        <div className="space-y-5 p-5 lg:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Heading" htmlFor="pc-title">
              <Input
                id="pc-title"
                value={title}
                onChange={(e) => { touch(); setTitle(e.target.value); }}
                placeholder="Payment-gateway charges apply"
              />
            </Field>
            <Field label="Intro line" htmlFor="pc-intro">
              <Input
                id="pc-intro"
                value={intro}
                onChange={(e) => { touch(); setIntro(e.target.value); }}
                placeholder="The transaction fee depends on the payment method…"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-ink-100/70 px-5 pb-2 pt-4 lg:px-6">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Fee by payment method</span>
          <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addRow}>
            Add method
          </Button>
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <Th>Payment method</Th>
              <Th right className="w-36">Fee</Th>
              <Th className="w-12"><span className="sr-only">Remove</span></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="!py-2">
                  <Input
                    inputSize="sm"
                    aria-label={`Method ${i + 1} name`}
                    value={r.label}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                    placeholder="e.g. Credit Card"
                  />
                </td>
                <td className="!py-2">
                  <Input
                    inputSize="sm"
                    aria-label={`Method ${i + 1} fee`}
                    value={r.rate}
                    onChange={(e) => updateRow(i, { rate: e.target.value })}
                    placeholder="1.95%"
                    className="text-right tabular-nums"
                  />
                </td>
                <td className="!py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={rows.length <= 1}
                    title={rows.length <= 1 ? "At least one method is required" : "Remove"}
                    aria-label="Remove method"
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-4 border-t border-ink-100/70 p-5 lg:p-6">
          <Field label="Footnote" htmlFor="pc-footnote">
            <Textarea
              id="pc-footnote"
              rows={2}
              value={footnote}
              onChange={(e) => { touch(); setFootnote(e.target.value); }}
              placeholder="18% GST is applied on the total amount…"
            />
          </Field>
          <FormError>{error}</FormError>
          <div className="flex items-center justify-end gap-3 border-t border-ink-100/70 pt-4">
            {saved ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-700">
                <Check className="h-3.5 w-3.5" /> Saved — live on the checkout page
              </span>
            ) : null}
            <Button icon={<Save className="h-3.5 w-3.5" />} onClick={save} busy={busy}>
              Save changes
            </Button>
          </div>
        </div>
      </Card>

      {/* Live preview — the checkout notice, as a parent sees it. */}
      <aside className="xl:sticky xl:top-6">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Preview · checkout page
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-[13px] text-ink-800">
          <p className="font-semibold text-ink-900">{title || "Heading"}</p>
          {intro ? <p className="mt-1 text-ink-700">{intro}</p> : null}
          <table className="mt-3 w-full text-[12.5px]">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="[&>td]:!bg-transparent">
                  <td className="!border-t !border-amber-200/70 !px-0 !py-1.5 !pr-2 !font-normal !text-ink-800">{r.label || <span className="text-ink-400">Method</span>}</td>
                  <td className="!border-t !border-amber-200/70 !px-0 !py-1.5 text-right tabular-nums">{r.rate || <span className="text-ink-400">0%</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {footnote ? <p className="mt-3 text-[11.5px] leading-relaxed text-ink-600">{footnote}</p> : null}
        </div>
      </aside>
    </div>
  );
}
