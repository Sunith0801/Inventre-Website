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
 * India GST state codes, keyed by normalized (lower-cased, trimmed) state
 * name plus common aliases. Used to build a proper `place_of_supply`
 * ("<code>-<Canonical Name>", e.g. "33-Tamil Nadu") when an admin edits an
 * order's shipping address to another state — the pincode-only heuristic in
 * `placeOfSupply` collapses everything outside Telangana to "99-Other",
 * which would silently degrade GST data for genuine out-of-state orders.
 */
const GST_STATE_CODES: Record<string, { code: string; name: string }> = {
  "jammu and kashmir": { code: "01", name: "Jammu and Kashmir" },
  "himachal pradesh": { code: "02", name: "Himachal Pradesh" },
  punjab: { code: "03", name: "Punjab" },
  chandigarh: { code: "04", name: "Chandigarh" },
  uttarakhand: { code: "05", name: "Uttarakhand" },
  uttaranchal: { code: "05", name: "Uttarakhand" },
  haryana: { code: "06", name: "Haryana" },
  delhi: { code: "07", name: "Delhi" },
  "new delhi": { code: "07", name: "Delhi" },
  rajasthan: { code: "08", name: "Rajasthan" },
  "uttar pradesh": { code: "09", name: "Uttar Pradesh" },
  bihar: { code: "10", name: "Bihar" },
  sikkim: { code: "11", name: "Sikkim" },
  "arunachal pradesh": { code: "12", name: "Arunachal Pradesh" },
  nagaland: { code: "13", name: "Nagaland" },
  manipur: { code: "14", name: "Manipur" },
  mizoram: { code: "15", name: "Mizoram" },
  tripura: { code: "16", name: "Tripura" },
  meghalaya: { code: "17", name: "Meghalaya" },
  assam: { code: "18", name: "Assam" },
  "west bengal": { code: "19", name: "West Bengal" },
  jharkhand: { code: "20", name: "Jharkhand" },
  odisha: { code: "21", name: "Odisha" },
  orissa: { code: "21", name: "Odisha" },
  chhattisgarh: { code: "22", name: "Chhattisgarh" },
  chattisgarh: { code: "22", name: "Chhattisgarh" },
  "madhya pradesh": { code: "23", name: "Madhya Pradesh" },
  gujarat: { code: "24", name: "Gujarat" },
  "dadra and nagar haveli and daman and diu": {
    code: "26",
    name: "Dadra and Nagar Haveli and Daman and Diu",
  },
  maharashtra: { code: "27", name: "Maharashtra" },
  karnataka: { code: "29", name: "Karnataka" },
  goa: { code: "30", name: "Goa" },
  lakshadweep: { code: "31", name: "Lakshadweep" },
  kerala: { code: "32", name: "Kerala" },
  "tamil nadu": { code: "33", name: "Tamil Nadu" },
  tamilnadu: { code: "33", name: "Tamil Nadu" },
  puducherry: { code: "34", name: "Puducherry" },
  pondicherry: { code: "34", name: "Puducherry" },
  "andaman and nicobar islands": {
    code: "35",
    name: "Andaman and Nicobar Islands",
  },
  telangana: { code: "36", name: "Telangana" },
  "andhra pradesh": { code: "37", name: "Andhra Pradesh" },
  ladakh: { code: "38", name: "Ladakh" },
};

/** Canonical list of Indian states/UTs for admin dropdowns (name only). */
export const INDIAN_STATES: string[] = Array.from(
  new Set(Object.values(GST_STATE_CODES).map((s) => s.name))
).sort();

/**
 * Build `place_of_supply` from a state name, falling back to the pincode
 * heuristic when the name is unrecognized. Prefer this over `placeOfSupply`
 * whenever the caller has an explicit state (e.g. an edited shipping
 * address) — it preserves the real state code for out-of-state orders.
 */
export function placeOfSupplyFromState(
  state: string | null | undefined,
  pincode: string
): string {
  const key = (state ?? "").trim().toLowerCase();
  const hit = GST_STATE_CODES[key];
  if (hit) return `${hit.code}-${hit.name}`;
  return placeOfSupply(pincode);
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
