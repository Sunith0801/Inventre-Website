import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shipments,
  shipmentItems,
  orders,
  parents,
  invoices,
  productVariants,
  products,
} from "@/db/schema";

/**
 * e-Way Bill (EWB) client.
 *
 * Required when a single consignment in inter-state movement crosses ₹50,000.
 *
 * Required env (set via your GSP, often the same one as e-Invoice):
 *   EWAYBILL_USERNAME       — GSP-issued auth username
 *   EWAYBILL_PASSWORD       — GSP-issued password
 *   EWAYBILL_GSTIN          — Your merchant GSTIN
 *   EWAYBILL_API_BASE       — e.g. https://gst.gov.in/ewb-api or your GSP relay
 *
 * In dev (no env), `submitEWB` returns a stub EWB number so downstream code
 * can develop end-to-end.
 */

export type EWBResponse = {
  ewbNo: string;
  ewbDate: string;
  validUpto: string;
  status: "submitted" | "stubbed";
};

export function isEWBConfigured(): boolean {
  return !!(
    process.env.EWAYBILL_USERNAME &&
    process.env.EWAYBILL_PASSWORD &&
    process.env.EWAYBILL_GSTIN &&
    process.env.EWAYBILL_API_BASE
  );
}

/**
 * Build the EWB payload for a shipment id. Schema: NIC EWB v1.03 / GenEwayBill.
 */
export async function buildEWBPayload(shipmentId: string) {
  const [ship] = await db
    .select({
      shipment: shipments,
      order: orders,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  if (!ship) throw new Error(`Shipment ${shipmentId} not found`);

  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.id, ship.order.parentId))
    .limit(1);

  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.orderId, ship.order.id))
    .limit(1);

  const items = await db
    .select({
      item: shipmentItems,
      product: products,
      variant: productVariants,
    })
    .from(shipmentItems)
    .innerJoin(productVariants, eq(productVariants.id, shipmentItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(shipmentItems.shipmentId, shipmentId));

  const shipping = (ship.order.shippingAddress as Record<string, string>) ?? {};
  const fromState = (ship.order.placeOfSupply ?? "36-Telangana").split("-")[0];

  return {
    supplyType: "O", // Outward
    subSupplyType: "1", // Supply
    docType: "INV",
    docNo: inv?.invoiceNumber ?? ship.order.orderNumber,
    docDate: (inv?.postingDate ?? ship.order.placedAt?.toISOString().slice(0, 10) ??
      new Date().toISOString().slice(0, 10)),
    fromGstin: process.env.EWAYBILL_GSTIN ?? "00AAAAA0000A1Z5",
    fromTrdName: process.env.MERCHANT_LEGAL_NAME ?? "Inventre",
    fromAddr1: process.env.MERCHANT_ADDR1 ?? "",
    fromPlace: process.env.MERCHANT_CITY ?? "",
    fromPincode: parseInt(process.env.MERCHANT_PINCODE ?? "0", 10),
    fromStateCode: parseInt(fromState, 10),
    toGstin: inv?.customerGstin ?? "URP",
    toTrdName: parent?.name ?? "Customer",
    toAddr1: shipping.line1 ?? "",
    toPlace: shipping.city ?? "",
    toPincode: parseInt(String(shipping.pincode ?? "000000"), 10),
    toStateCode: parseInt(
      (ship.order.placeOfSupply ?? "36-Telangana").split("-")[0],
      10
    ),
    transactionType: 1,
    totalValue: ship.order.subtotal / 100,
    cgstValue: 0,
    sgstValue: 0,
    igstValue: 0,
    cessValue: 0,
    totInvValue: ship.order.total / 100,
    transMode: "1", // 1 = Road
    transDistance: 100, // Placeholder — should come from operator
    transporterId: "",
    transporterName: ship.shipment.courier ?? "",
    transDocNo: ship.shipment.trackingNumber ?? "",
    transDocDate: (ship.shipment.shippedAt ?? new Date())
      .toISOString()
      .slice(0, 10),
    vehicleNo: "",
    vehicleType: "R",
    itemList: items.map((it) => ({
      productName: it.product.name.slice(0, 50),
      productDesc: it.product.name.slice(0, 50),
      hsnCode: parseInt(it.product.hsnCode ?? "61012000", 10),
      quantity: it.item.qty,
      qtyUnit: "PCS",
      taxableAmount: 0, // For uniforms taxes are usually inclusive
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      cessRate: 0,
    })),
  };
}

export async function submitEWB(shipmentId: string): Promise<EWBResponse> {
  const payload = await buildEWBPayload(shipmentId);

  if (!isEWBConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "e-Way Bill not configured (EWAYBILL_USERNAME/PASSWORD/GSTIN/API_BASE)."
      );
    }
    const mock = `STUB${Date.now().toString().slice(-9)}`;
    await db
      .update(shipments)
      .set({
        ewaybillNumber: mock,
        ewaybillStatus: "submitted",
      })
      .where(eq(shipments.id, shipmentId));
    return {
      ewbNo: mock,
      ewbDate: new Date().toISOString(),
      validUpto: new Date(Date.now() + 7 * 86400_000).toISOString(),
      status: "stubbed",
    };
  }

  const res = await fetch(
    `${process.env.EWAYBILL_API_BASE!.replace(/\/$/, "")}/ewayapi`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        username: process.env.EWAYBILL_USERNAME!,
        password: process.env.EWAYBILL_PASSWORD!,
        Gstin: process.env.EWAYBILL_GSTIN!,
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EWB error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    ewayBillNo: string;
    ewayBillDate: string;
    validUpto: string;
  };

  await db
    .update(shipments)
    .set({
      ewaybillNumber: data.ewayBillNo,
      ewaybillStatus: "submitted",
    })
    .where(eq(shipments.id, shipmentId));

  return {
    ewbNo: data.ewayBillNo,
    ewbDate: data.ewayBillDate,
    validUpto: data.validUpto,
    status: "submitted",
  };
}
