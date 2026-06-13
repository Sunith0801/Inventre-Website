/**
 * Carrier registry — tracking-URL templates per carrier.
 * Admin can add more in /admin/settings/shipping (Phase 6).
 */

export type Carrier = {
  code: string;
  name: string;
  trackingUrlTemplate: string; // {tracking} is replaced with the AWB number
};

// Tracking-URL strategy: most courier sites in India rotate their public
// tracker paths quietly (DTDC's .in domain moved to .com mid-2026 and
// dropped query-string lookups in the process; Shiprocket's customer
// portal needs a logged-in session). To keep the parent's "Track on
// carrier" button reliable, we route through trackcourier.io as a stable
// aggregator that accepts any AWB for the carriers we use. The
// aggregator URL pattern itself is also stable across years.
export const CARRIERS: Carrier[] = [
  {
    code: "delhivery",
    name: "Delhivery",
    trackingUrlTemplate: "https://www.delhivery.com/track-v2/package/{tracking}",
  },
  {
    code: "bluedart",
    name: "Bluedart",
    trackingUrlTemplate:
      "https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo={tracking}",
  },
  {
    code: "dtdc",
    name: "DTDC",
    trackingUrlTemplate: "https://trackcourier.io/track-and-trace/dtdc/{tracking}",
  },
  {
    code: "srocket",
    name: "Shiprocket",
    trackingUrlTemplate: "https://trackcourier.io/track-and-trace/shiprocket/{tracking}",
  },
  {
    code: "shiprocket",
    name: "Shiprocket",
    trackingUrlTemplate: "https://trackcourier.io/track-and-trace/shiprocket/{tracking}",
  },
  {
    code: "indiapost",
    name: "India Post",
    trackingUrlTemplate:
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?ItemId={tracking}",
  },
  {
    code: "professional",
    name: "Professional Couriers",
    trackingUrlTemplate: "https://www.tpcindia.com/Tracking2.aspx?id={tracking}",
  },
];

export function trackingUrlFor(carrierCode: string, awb: string): string | null {
  const c = CARRIERS.find((x) => x.code === carrierCode.toLowerCase());
  if (!c) return null;
  return c.trackingUrlTemplate.replace("{tracking}", encodeURIComponent(awb));
}

export function carrierByCode(code: string): Carrier | null {
  return CARRIERS.find((x) => x.code === code.toLowerCase()) ?? null;
}
