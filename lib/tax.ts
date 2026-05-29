/**
 * GST tax engine — pure functions, no DB.
 *
 * Used by:
 *   - Phase 5 (order create): preview tax totals at checkout
 *   - Phase 7 (invoice gen):  authoritative computation per line
 *
 * Conventions:
 *   - All amounts in PAISE (×100 integer).
 *   - Rates are percent expressed as float string ("9", "18", "0").
 *   - In-state vs out-state determined by company state vs shipping state.
 *   - Company state: Telangana (state code 36). Pincodes 500000–536999.
 */

export type GstTreatment =
  | "taxable"
  | "nil_rated"
  | "exempt"
  | "non_gst"
  | "zero_rated";

export type TaxLine = {
  /**
   * For `gstInclusive=false`: this is the pre-tax (net) amount; tax is added on top.
   * For `gstInclusive=true`:  this is the customer-facing amount; tax is reverse-extracted.
   */
  netAmountPaise: number;
  hsnCode: string | null;
  gstTreatment: GstTreatment;
  /** Whether the price already includes GST (Indian retail convention is true). */
  gstInclusive?: boolean;
  /** Optional explicit rate; if absent we use the default 18% for taxable. */
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
};

export type ComputedTax = {
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  lineTotal: number; // netAmount + totalTax
};

export type TaxContext = {
  /** Company state code, e.g. "36" for Telangana. */
  companyStateCode: string;
  /** Customer shipping state code, derived from pincode. */
  shippingStateCode: string;
};

const TELANGANA_PIN_LO = 500000;
const TELANGANA_PIN_HI = 536999;
const COMPANY_STATE_CODE = "36"; // Telangana
const DEFAULT_GST_RATE = 18; // for taxable items without explicit rate

/**
 * Map a 6-digit Indian pincode to a state code.
 * Currently only distinguishes Telangana (36) vs not-Telangana ("99" sentinel).
 * Extend with full pincode→state lookup when needed.
 */
export function stateCodeFromPincode(pincode: string): string {
  const pin = parseInt(pincode, 10);
  if (Number.isNaN(pin)) return "99";
  if (pin >= TELANGANA_PIN_LO && pin <= TELANGANA_PIN_HI) return "36";
  return "99"; // out-state sentinel; refine if you need full state mapping
}

export function isInState(ctx: TaxContext): boolean {
  return ctx.companyStateCode === ctx.shippingStateCode;
}

/** ERP audit §3.6 — "Output GST In-state - IESPL" vs "Output GST Out-state - IESPL". */
export function getTaxTemplateName(pincode: string): string {
  return stateCodeFromPincode(pincode) === COMPANY_STATE_CODE
    ? "Output GST In-state - IESPL"
    : "Output GST Out-state - IESPL";
}

/** Compute place_of_supply string ("36-Telangana" / "99-Other"). */
export function placeOfSupply(pincode: string): string {
  const code = stateCodeFromPincode(pincode);
  if (code === "36") return "36-Telangana";
  return `${code}-Other`;
}

/**
 * Compute tax for a single line.
 * - Nil-Rated / Exempt / Zero-Rated / Non-GST → all rates = 0.
 * - Taxable + in-state  → CGST + SGST split.
 * - Taxable + out-state → IGST.
 */
export function computeLineTax(line: TaxLine, ctx: TaxContext): ComputedTax {
  // Non-taxable treatments
  if (
    line.gstTreatment === "nil_rated" ||
    line.gstTreatment === "exempt" ||
    line.gstTreatment === "non_gst" ||
    line.gstTreatment === "zero_rated"
  ) {
    return {
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalTax: 0,
      lineTotal: line.netAmountPaise,
    };
  }

  const inclusive = line.gstInclusive ?? true;
  const inState = isInState(ctx);

  if (inState) {
    // Split rate evenly between CGST and SGST.
    const total = line.cgstRate ?? line.igstRate ?? DEFAULT_GST_RATE;
    const cgstRate = line.cgstRate ?? total / 2;
    const sgstRate = line.sgstRate ?? total / 2;
    const totalRate = cgstRate + sgstRate;

    // Inclusive: extract tax from total. Net = total / (1 + rate/100)
    // Exclusive: tax is added to net.
    const net = inclusive
      ? Math.round(line.netAmountPaise / (1 + totalRate / 100))
      : line.netAmountPaise;

    const cgstAmount = Math.round((net * cgstRate) / 100);
    const sgstAmount = Math.round((net * sgstRate) / 100);
    const totalTax = cgstAmount + sgstAmount;
    return {
      cgstRate,
      sgstRate,
      igstRate: 0,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
      totalTax,
      lineTotal: inclusive ? line.netAmountPaise : net + totalTax,
    };
  }

  // Out-of-state: IGST
  const sumOfSplit = (line.cgstRate ?? 0) + (line.sgstRate ?? 0);
  const igstRate = line.igstRate ?? (sumOfSplit > 0 ? sumOfSplit : DEFAULT_GST_RATE);
  const net = inclusive
    ? Math.round(line.netAmountPaise / (1 + igstRate / 100))
    : line.netAmountPaise;
  const igstAmount = Math.round((net * igstRate) / 100);
  return {
    cgstRate: 0,
    sgstRate: 0,
    igstRate,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount,
    totalTax: igstAmount,
    lineTotal: inclusive ? line.netAmountPaise : net + igstAmount,
  };
}

export type InvoiceTotals = {
  netTotal: number; // sum of line net amounts (paise)
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  grandTotalUnrounded: number;
  grandTotal: number; // rounded to nearest rupee
  roundingAdjustment: number; // +/- in paise
  lines: ComputedTax[];
};

export function computeInvoiceTotals(
  lines: TaxLine[],
  shippingPincode: string
): InvoiceTotals {
  const ctx: TaxContext = {
    companyStateCode: COMPANY_STATE_CODE,
    shippingStateCode: stateCodeFromPincode(shippingPincode),
  };

  let netTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  const computed: ComputedTax[] = [];

  for (const line of lines) {
    const c = computeLineTax(line, ctx);
    netTotal += line.netAmountPaise;
    cgstTotal += c.cgstAmount;
    sgstTotal += c.sgstAmount;
    igstTotal += c.igstAmount;
    computed.push(c);
  }

  const taxTotal = cgstTotal + sgstTotal + igstTotal;
  const grandTotalUnrounded = netTotal + taxTotal;
  // Round to nearest rupee (100 paise)
  const grandTotal = Math.round(grandTotalUnrounded / 100) * 100;
  const roundingAdjustment = grandTotal - grandTotalUnrounded;

  return {
    netTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    grandTotalUnrounded,
    grandTotal,
    roundingAdjustment,
    lines: computed,
  };
}

export const COMPANY_STATE = COMPANY_STATE_CODE;
