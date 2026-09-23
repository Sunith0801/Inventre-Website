/**
 * Shape of GET /api/orders/[id] as the storefront order page consumes it, and
 * the shared status vocabulary. Extracted from app/shop/orders/[id]/page.tsx
 * on 2026-09-23 (F-08) so the tracking card and status pill can live in their
 * own files.
 */
export type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  createdAt: string;
  studentName?: string | null;
  enrollment?: string | null;
  shippingAddress: {
    receiverName: string;
    receiverPhone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  items: {
    id: string;
    name: string;
    size: string;
    /** Per-axis attributes (Colour · Size) for a plain line item, resolved
     *  from product_variant_attributes — same enrichment Magic Box contents
     *  get. Empty for legacy variants with no attribute rows. */
    attributes?: { name: string; value: string }[];
    qty: number;
    unitPrice: number;
    total: number;
    imageUrl: string;
    /** Per-item delivery status for a plain line (null for Magic Box parents,
     *  which show per-component status inside "Box contents"). */
    status?: CategoryStatus | null;
    bundleSelections:
      | {
          componentProductId: string;
          name: string;
          qty: number;
          variantId: string;
          size: string;
          attributes: { name: string; value: string }[];
          /** Per-component delivery status; null when the box isn't
           *  line-level tracked (then no per-component badge is shown). */
          status?: CategoryStatus | null;
          /** Shipment category (lowercased) this component belongs to, so it
           *  can be listed inside the matching per-category tracking card. */
          category?: string | null;
        }[]
      | null;
  }[];
  payment: { provider: string; status: string; method: string | null } | null;
  rto?: {
    active: boolean;
    delivered: boolean;
    stage: string | null;
    timeline: { at: string; label: string; location: string | null }[];
  } | null;
  tracking?: {
    partner: string;
    trackingNumber: string | null;
    status: string;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  }[];
  shipmentHistory?: {
    shipmentId: number | null;
    partner: string;
    mode: "auto" | "manual" | null;
    trackingNumber: string | null;
    status: string;
    itemCategory: string | null;
    description: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    carrierEventCount: number;
    events: {
      kind: "system" | "carrier";
      at: string;
      label: string;
      source: string | null;
      badge: string;
    }[];
  }[];
  categoryGroups?: {
    rootCategoryId: string | null;
    rootCategoryName: string;
    totalQty: number;
    deliveredQty: number;
    pickedQty: number;
    returnedQty: number;
    status: CategoryStatus;
    items: {
      id: string;
      name: string;
      qty: number;
      deliveredQty: number;
      pickedQty: number;
      returnedQty: number;
      itemCode: string | null;
      status: CategoryStatus;
    }[];
  }[];
  pollPending?: boolean;
  paymentStatusRaw?: string | null;
  canReorder?: boolean;
};

export type CategoryStatus =
  | "delivered"
  | "out for delivery"
  | "in transit"
  | "returned"
  | "pending";

// 7-stage pipeline. "in transit" and "out for delivery" are intentionally
// distinct from "shipped" so the stage bar reflects audit's real progress
// (a parcel that's been picked up but not yet on the truck is "shipped";
// once the carrier scans a line-haul leg it's "in transit"; the final
// hop is "out for delivery"). Multi-word labels wrap to two lines on
// narrow viewports — full phrasing reads better than the OFD shorthand.
export const stages = [
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "in transit",
  "out for delivery",
  "delivered",
] as const;
