import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";
import {
  DEFAULT_PAYMENT_CHARGES,
  isValidPaymentChargesConfig,
  type PaymentChargesConfig,
} from "@/lib/payment-charges-defaults";

export const PAYMENT_CHARGES_KEY = "payment_charges";

export {
  DEFAULT_PAYMENT_CHARGES,
  isValidPaymentChargesConfig,
  type PaymentChargeRow,
  type PaymentChargesConfig,
} from "@/lib/payment-charges-defaults";

export async function getPaymentCharges(): Promise<PaymentChargesConfig> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, PAYMENT_CHARGES_KEY))
    .limit(1);
  const value = rows[0]?.value;
  return isValidPaymentChargesConfig(value) ? value : DEFAULT_PAYMENT_CHARGES;
}
