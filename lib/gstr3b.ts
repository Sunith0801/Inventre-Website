import "server-only";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";

/**
 * GSTR-3B summary builder.
 *
 * GSTR-3B is the monthly self-declaration return — six sections:
 *   3.1  Outward + reverse-charge inward supplies (taxable, IGST, CGST, SGST, cess)
 *   3.2  Of supplies in 3.1, supplies to UIN/Composition/Unregistered
 *   4    ITC (input tax credit availed) — left empty here, accountant fills
 *   5    Exempt / nil / non-GST supplies
 *   6.1  Tax payable + paid (cash + ITC) — left to accountant
 *   6.2  TDS/TCS credit (rare; left zero)
 *
 * We compute the outward-side sections (3.1 + 5) automatically from
 * `invoices` + `invoice_items`. Section 4 and 6 require purchase data
 * + bank-side reconciliation that lives in the Payment Entry world; we
 * surface those as zero placeholders for the accountant to override.
 */

export type Gstr3bDocument = {
  gstin: string;
  ret_period: string; // MMYYYY
  sup_details: {
    osup_det: { txval: number; iamt: number; camt: number; samt: number; csamt: number };
    osup_zero: { txval: number; iamt: number; csamt: number };
    osup_nil_exmp: { txval: number };
    isup_rev: { txval: number; iamt: number; camt: number; samt: number; csamt: number };
    osup_nongst: { txval: number };
  };
  inter_sup: {
    unreg_details: { pos: string; txval: number; iamt: number }[];
    comp_details: unknown[];
    uin_details: unknown[];
  };
  itc_elg: {
    itc_avl: unknown[];
    itc_rev: unknown[];
    itc_net: { iamt: number; camt: number; samt: number; csamt: number };
    itc_inelg: unknown[];
  };
  inward_sup: {
    isup_details: unknown[];
  };
  tax_pmt: {
    cash_pmt: { iamt: number; camt: number; samt: number; csamt: number };
    itc_pmt: { iamt: number; camt: number; samt: number; csamt: number };
  };
};

export async function buildGstr3b(period: { from: string; to: string }): Promise<Gstr3bDocument> {
  const merchantGstin = process.env.MERCHANT_GSTIN ?? "00AAAAA0000A1Z5";
  const [yr, mo] = period.from.split("-");
  const retPeriod = `${mo}${yr}`;

  const conds = [
    gte(invoices.postingDate, period.from),
    lte(invoices.postingDate, period.to),
    sql`${invoices.status} != 'cancelled'`,
  ];

  // Section 3.1(a) — Outward taxable supplies (other than zero-rated/exempt/nil)
  const [taxable] = await db
    .select({
      txval: sql<number>`COALESCE(SUM(${invoiceItems.taxableAmount}), 0)::bigint`,
      iamt: sql<number>`COALESCE(SUM(${invoiceItems.igstAmount}), 0)::bigint`,
      camt: sql<number>`COALESCE(SUM(${invoiceItems.cgstAmount}), 0)::bigint`,
      samt: sql<number>`COALESCE(SUM(${invoiceItems.sgstAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(...conds, sql`${invoiceItems.gstTreatment} = 'taxable'`));

  // Section 3.1(c) — Other (Nil-rated, Exempt)
  const [nilExempt] = await db
    .select({
      txval: sql<number>`COALESCE(SUM(${invoiceItems.netAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      and(
        ...conds,
        sql`${invoiceItems.gstTreatment} IN ('nil_rated', 'exempt')`
      )
    );

  // Section 3.1(e) — Non-GST outward
  const [nonGst] = await db
    .select({
      txval: sql<number>`COALESCE(SUM(${invoiceItems.netAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(...conds, sql`${invoiceItems.gstTreatment} = 'non_gst'`));

  // Section 3.2 — Inter-state supplies to unregistered
  const interUnregRows = await db
    .select({
      pos: invoices.placeOfSupply,
      txval: sql<number>`COALESCE(SUM(${invoiceItems.taxableAmount}), 0)::bigint`,
      iamt: sql<number>`COALESCE(SUM(${invoiceItems.igstAmount}), 0)::bigint`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      and(
        ...conds,
        sql`${invoices.customerGstin} IS NULL`,
        sql`${invoiceItems.igstAmount} > 0`
      )
    )
    .groupBy(invoices.placeOfSupply);

  const interUnreg = interUnregRows
    .filter((r) => r.pos != null)
    .map((r) => ({
      pos: (r.pos ?? "").split("-")[0] || "00",
      txval: Math.round(Number(r.txval) / 100),
      iamt: Math.round(Number(r.iamt) / 100),
    }));

  return {
    gstin: merchantGstin,
    ret_period: retPeriod,
    sup_details: {
      osup_det: {
        txval: Math.round(Number(taxable?.txval ?? 0) / 100),
        iamt: Math.round(Number(taxable?.iamt ?? 0) / 100),
        camt: Math.round(Number(taxable?.camt ?? 0) / 100),
        samt: Math.round(Number(taxable?.samt ?? 0) / 100),
        csamt: 0,
      },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: {
        txval: Math.round(Number(nilExempt?.txval ?? 0) / 100),
      },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: {
        txval: Math.round(Number(nonGst?.txval ?? 0) / 100),
      },
    },
    inter_sup: {
      unreg_details: interUnreg,
      comp_details: [],
      uin_details: [],
    },
    itc_elg: {
      itc_avl: [],
      itc_rev: [],
      itc_net: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
      itc_inelg: [],
    },
    inward_sup: { isup_details: [] },
    tax_pmt: {
      cash_pmt: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
      itc_pmt: { iamt: 0, camt: 0, samt: 0, csamt: 0 },
    },
  };
}
