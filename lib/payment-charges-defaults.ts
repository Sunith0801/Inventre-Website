/**
 * Shape + defaults for the admin-editable payment-gateway fee schedule.
 * Lives in its own file (no DB import) so client components — notably
 * /shop/checkout — can import the type and the fallback without dragging
 * the server-only postgres client into their bundle.
 */

export type PaymentChargeRow = {
  label: string;
  rate: string;
};

export type PaymentChargesConfig = {
  title: string;
  intro: string;
  rows: PaymentChargeRow[];
  footnote: string;
};

export const DEFAULT_PAYMENT_CHARGES: PaymentChargesConfig = {
  title: "Payment-gateway charges apply",
  intro: "The transaction fee depends on the payment method you choose on the next page:",
  rows: [
    { label: "Credit Card (Visa / Master / RuPay)", rate: "1.95%" },
    { label: "Debit Card", rate: "1.25%" },
    { label: "RuPay Debit Card", rate: "1.00%" },
    { label: "UPI (standard)", rate: "1.00%" },
    { label: "UPI via credit card / wallet", rate: "2.00%" },
    { label: "Net Banking", rate: "1.80%" },
  ],
  footnote:
    "18% GST is applied on the total amount (including the transaction fee) as per government regulations. The fee above includes a 1% platform charge irrespective of the payment mode chosen.",
};

export function isValidPaymentChargesConfig(
  v: unknown,
): v is PaymentChargesConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (typeof o.intro !== "string") return false;
  if (typeof o.footnote !== "string") return false;
  if (!Array.isArray(o.rows)) return false;
  return o.rows.every(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof (r as Record<string, unknown>).label === "string" &&
      typeof (r as Record<string, unknown>).rate === "string",
  );
}
