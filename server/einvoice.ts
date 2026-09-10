import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems, parents } from "@/db/schema";

/**
 * e-Invoice / IRN client interface.
 *
 * The NIC IRP (Invoice Registration Portal) requires:
 *   1. A registered GSTIN authorized via NIC (e-Invoice portal enrollment)
 *   2. A GSP (GST Suvidha Provider) — Cleartax, IRIS, Masters India, etc.
 *      Most provide a REST relay over the NIC API.
 *   3. Sandbox credentials first; switch to prod after passing test invoices.
 *
 * Required env (set via your GSP):
 *   EINVOICE_USERNAME       — GSP-issued auth username
 *   EINVOICE_PASSWORD       — GSP-issued password
 *   EINVOICE_GSTIN          — Your merchant GSTIN
 *   EINVOICE_API_BASE       — e.g. https://gst.gov.in or your GSP relay
 *
 * This module produces the IRN-spec JSON (Schema v1.1) and exposes
 * `submitIrn(invoiceId)` that POSTs to the GSP relay. The actual HTTP call is
 * stubbed when not configured: returns { irn, signedQrCode, status: "stubbed" }
 * so the rest of the app can be developed end-to-end without a live merchant
 * account.
 */

export type IrnResponse = {
  irn: string; // 64-char IRN
  ackNo: string; // acknowledgement
  ackDate: string; // ISO
  signedInvoice: string; // JWT-style signed payload
  signedQrCode: string; // QR-code data
  status: "submitted" | "stubbed";
};

export function isEInvoiceConfigured(): boolean {
  return !!(
    process.env.EINVOICE_USERNAME &&
    process.env.EINVOICE_PASSWORD &&
    process.env.EINVOICE_GSTIN &&
    process.env.EINVOICE_API_BASE
  );
}

/**
 * Build the IRP-spec invoice JSON for a single invoice id.
 * Schema reference: NIC IRP v1.1 — TranDtls / DocDtls / SellerDtls /
 * BuyerDtls / ItemList / ValDtls.
 */
export async function buildIrpPayload(invoiceId: string) {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);

  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.id, inv.parentId))
    .limit(1);

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId));

  const billing =
    (inv.billingAddress as Record<string, string> | null) ?? {
      line1: "",
      city: "",
      state: "",
      pincode: "000000",
    };

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: "N",
      EcmGstin: null,
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: inv.isReturn ? "CRN" : inv.isDebitNote ? "DBN" : "INV",
      No: inv.invoiceNumber,
      Dt: fmtDate(inv.postingDate),
    },
    SellerDtls: {
      Gstin: process.env.EINVOICE_GSTIN ?? "00AAAAA0000A1Z5",
      LglNm: process.env.MERCHANT_LEGAL_NAME ?? "Inventre",
      Addr1: process.env.MERCHANT_ADDR1 ?? "",
      Loc: process.env.MERCHANT_CITY ?? "",
      Pin: parseInt(process.env.MERCHANT_PINCODE ?? "0", 10),
      Stcd: process.env.MERCHANT_STATE_CODE ?? "36",
    },
    BuyerDtls: {
      Gstin: inv.customerGstin ?? "URP",
      LglNm: parent?.name ?? "Customer",
      Pos: (inv.placeOfSupply ?? "36-Telangana").split("-")[0],
      Addr1: billing.line1 ?? "",
      Loc: billing.city ?? "",
      Pin: parseInt(String(billing.pincode ?? "000000"), 10),
      Stcd: (inv.placeOfSupply ?? "36-Telangana").split("-")[0],
    },
    ItemList: items.map((it, idx) => ({
      SlNo: String(idx + 1),
      PrdDesc: it.itemNameSnapshot.slice(0, 100),
      HsnCd: it.hsnCode ?? "",
      Qty: it.qty,
      Unit: "PCS",
      UnitPrice: it.unitPrice / 100,
      TotAmt: (it.unitPrice * it.qty) / 100,
      Discount: it.discountAmount / 100,
      AssAmt: it.taxableAmount / 100,
      GstRt: Number(it.cgstRate) + Number(it.sgstRate) + Number(it.igstRate),
      IgstAmt: it.igstAmount / 100,
      CgstAmt: it.cgstAmount / 100,
      SgstAmt: it.sgstAmount / 100,
      CesAmt: 0,
      StateCesAmt: 0,
      OthChrg: 0,
      TotItemVal: it.totalAmount / 100,
    })),
    ValDtls: {
      AssVal: inv.netTotal / 100,
      CgstVal: inv.cgstTotal / 100,
      SgstVal: inv.sgstTotal / 100,
      IgstVal: inv.igstTotal / 100,
      CesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: inv.roundingAdjustment / 100,
      TotInvVal: inv.grandTotal / 100,
    },
  };
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Submit the invoice to the IRP. In production, posts to the GSP relay; in
 * stub mode (no env), returns a deterministic mock IRN so downstream flows
 * (PDF generation, e-Way Bill chain) can run.
 */
export async function submitIrn(invoiceId: string): Promise<IrnResponse> {
  const payload = await buildIrpPayload(invoiceId);

  if (!isEInvoiceConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "e-Invoice not configured (EINVOICE_USERNAME/PASSWORD/GSTIN/API_BASE)."
      );
    }
    // Dev stub — record a pseudo-IRN
    const mock = `STUB-${invoiceId.slice(0, 8)}-${Date.now().toString(36)}`;
    await db
      .update(invoices)
      .set({
        einvoiceIrn: mock,
        einvoiceQrCode: `data:image/svg+xml;base64,${Buffer.from(
          "<svg xmlns='http://www.w3.org/2000/svg'/>"
        ).toString("base64")}`,
        einvoiceStatus: "generated",
      })
      .where(eq(invoices.id, invoiceId));
    return {
      irn: mock,
      ackNo: "STUB-ACK",
      ackDate: new Date().toISOString(),
      signedInvoice: "stub.jwt.payload",
      signedQrCode: "stub-qr",
      status: "stubbed",
    };
  }

  const res = await fetch(
    `${process.env.EINVOICE_API_BASE!.replace(/\/$/, "")}/eivital/v1.04/Invoice`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Most GSPs use a Bearer token they issue after username/password login;
        // this is a generic placeholder — adapt to your GSP's auth scheme.
        username: process.env.EINVOICE_USERNAME!,
        password: process.env.EINVOICE_PASSWORD!,
        Gstin: process.env.EINVOICE_GSTIN!,
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IRP error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    Irn: string;
    AckNo: string;
    AckDt: string;
    SignedInvoice: string;
    SignedQRCode: string;
  };

  await db
    .update(invoices)
    .set({
      einvoiceIrn: data.Irn,
      einvoiceQrCode: data.SignedQRCode,
      einvoiceStatus: "generated",
    })
    .where(eq(invoices.id, invoiceId));

  return {
    irn: data.Irn,
    ackNo: data.AckNo,
    ackDate: data.AckDt,
    signedInvoice: data.SignedInvoice,
    signedQrCode: data.SignedQRCode,
    status: "submitted",
  };
}
