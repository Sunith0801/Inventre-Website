"use client";

import { useState, useTransition } from "react";
import { Save, Copy, Check } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export function NewGiftCardForm() {
  const [amount, setAmount] = useState("500");
  const [toEmail, setToEmail] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const a = Number(amount);
    if (!Number.isFinite(a) || a < 1) {
      setError("Amount must be at least ₹1");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountRupees: a,
          toEmail: toEmail || null,
          toPhone: toPhone || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          notes: notes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setIssued({ code: data.code });
    });
  };

  if (issued) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
          <h3 className="text-[14px] font-semibold text-ink-900">
            Card issued — copy the code now
          </h3>
          <p className="text-[12px] text-ink-600 mt-1">
            This is shown only once. Send it to the recipient via your usual
            channel (email, WhatsApp, printed receipt).
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="font-mono text-[15px] bg-white border border-ink-200 rounded px-3 py-2 flex-1 break-all tracking-wide">
              {issued.code}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(issued.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 px-3 h-10 rounded-lg bg-ink-900 text-white text-[13px] font-semibold"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <a
          href="/admin/gift-cards"
          className="text-[13px] text-brand-700 font-semibold hover:underline"
        >
          ← Back to gift cards
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Amount (₹)" required>
        <input
          type="number"
          min={1}
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={inputClass}
        />
      </Field>
      <Field label="Expires (optional)">
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Recipient email" hint="Optional">
        <input
          type="email"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Recipient phone" hint="10-digit, optional">
        <input
          type="text"
          pattern="[0-9]{10}"
          value={toPhone}
          onChange={(e) => setToPhone(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Notes" className="lg:col-span-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass + " py-2 h-auto"}
        />
      </Field>
      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Issue card
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
