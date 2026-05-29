"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

const METHODS = [
  "cash",
  "upi",
  "card",
  "netbanking",
  "wallet",
  "ccavenue",
  "bank_transfer",
  "cheque",
  "other",
] as const;

export function NewPaymentForm() {
  const router = useRouter();
  const [direction, setDirection] = useState<"received" | "paid">("received");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("upi");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const paise = Math.round(parseFloat(amount) * 100);
    if (!paise || paise < 1) {
      setError("Enter a valid amount");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          method,
          amount: paise,
          paymentDate,
          referenceNumber: referenceNumber.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Failed to record payment");
        return;
      }
      router.push("/admin/payments");
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Direction" required>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as typeof direction)}
          className={inputClass}
        >
          <option value="received">Received from customer</option>
          <option value="paid">Paid out (refund / supplier)</option>
        </select>
      </Field>
      <Field label="Method" required>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className={inputClass}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount (₹)" required>
        <input
          type="number"
          step="0.01"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={inputClass}
        />
      </Field>
      <Field label="Payment date" required>
        <input
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          required
          className={inputClass}
        />
      </Field>
      <Field label="Reference / txn id" className="lg:col-span-2">
        <input
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          className={inputClass + " font-mono"}
          placeholder="UPI ref / cheque # / bank txn"
        />
      </Field>
      <Field label="Notes" className="lg:col-span-2">
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass + " py-2"}
        />
      </Field>

      <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Record payment
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
  required,
  children,
  className,
}: {
  label: string;
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
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
