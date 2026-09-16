"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, Textarea, FormGrid, FormError } from "@/components/admin/ui/primitives";

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
const METHOD_LABEL: Record<(typeof METHODS)[number], string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  wallet: "Wallet",
  ccavenue: "CCAvenue",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

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
      router.push("/admin/payments/entries");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <FormGrid cols={2}>
        <Field label="Type" htmlFor="pe-dir" required>
          <Select id="pe-dir" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
            <option value="received">Received from customer</option>
            <option value="paid">Paid out (refund)</option>
          </Select>
        </Field>
        <Field label="Method" htmlFor="pe-method" required>
          <Select id="pe-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>{METHOD_LABEL[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₹)" htmlFor="pe-amount" required>
          <Input id="pe-amount" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0.00" className="text-right tabular-nums" />
        </Field>
        <Field label="Payment date" htmlFor="pe-date" required>
          <Input id="pe-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
        </Field>
        <Field label="Reference" htmlFor="pe-ref" className="md:col-span-2">
          <Input id="pe-ref" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className="font-mono" placeholder="UPI ref, cheque number or bank transaction id" />
        </Field>
        <Field label="Notes" htmlFor="pe-notes" className="md:col-span-2">
          <Textarea id="pe-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </FormGrid>
      <FormError>{error}</FormError>
      <div className="flex items-center justify-end border-t border-ink-100/70 pt-4">
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Record payment
        </Button>
      </div>
    </form>
  );
}
