import "server-only";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  invoices,
  invoiceItems,
  parents,
  orders,
} from "@/db/schema";

/**
 * GSTR-1 JSON exporter.
 *
 * Builds the JSON payload that the GSTN portal accepts on monthly upload.
 * Spec reference: GSTR-1 v2.1 (sections b2b, b2cl, b2cs, hsn, cdnr, cdnur).
 *
 * Inventre is overwhelmingly B2C — the b2b section will usually be empty and
 * b2cs/hsn carry the bulk of the file. We still emit b2b and cdnr correctly
 * so the file passes portal validation when an occasional registered
 * customer purchase or return happens.
 *
 * IMPORTANT: this exporter produces a valid-shape JSON document. Actual
 * portal upload requires:
 *   - GSP integration credentials (or manual upload via the merchant's GSTN
 *     account)
 *   - The merchant's GSTIN (read from `process.env.MERCHANT_GSTIN` here for
 *     header section)
 *   - Cross-validation with GSTR-2A reconciliation
 * Treat this as a draft — accountants review before filing.
 */

type Period = { from: string; to: string }; // YYYY-MM-DD

type B2BInvoice = {
  ctin: string; // customer GSTIN
  inv: {
    inum: string;
    idt: string; // DD-MM-YYYY
    val: number; // total
    pos: string; // place of supply (state code "36")
    rchrg: "N" | "Y"; // reverse charge
    inv_typ: "R" | "DE" | "SEWP" | "SEWOP";
    itms: {
      num: number; // line number
      itm_det: {
        rt: number; // GST rate (%) — combined
        txval: number;
        iamt: number;
        camt: number;
        samt: number;
        csamt: number;
      };
    }[];
  }[];
};

type B2CLInvoice = {
  pos: string;
  inv: {
    inum: string;
    idt: string;
    val: number;
    itms: {
      num: number;
      itm_det: {
        rt: number;
        txval: number;
        iamt: number;
        csamt: number;
      };
    }[];
  }[];
};

type B2CSEntry = {
  sply_ty: "INTRA" | "INTER";
  pos: string;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
  typ: "OE";
};

type HSNEntry = {
  num: number;
  hsn_sc: string;
  desc: string;
  uqc: string; // e.g. "PCS-PIECES"
  qty: number;
  val: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
};

export type Gstr1Document = {
  gstin: string;
  fp: string; // filing period MMYYYY
  gt: number; // gross turnover prev year (placeholder)
  cur_gt: number; // current turnover (placeholder)
  b2b: B2BInvoice[];
  b2cl: B2CLInvoice[];
  b2cs: B2CSEntry[];
  hsn: { data: HSNEntry[] };
  cdnr: B2BInvoice[]; // credit/debit notes for registered
  cdnur: unknown[]; // credit/debit notes for unregistered (we emit empty)
};

function fmtDate(s: string): string {
  // posting_date is YYYY-MM-DD → DD-MM-YYYY
  const [y, m, d] = s.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * Combined GST rate when CGST+SGST split or pure IGST. Returns a percent integer.
 */
function combinedRate(line: typeof invoiceItems.$inferSelect): number {
  const c = Number(line.cgstRate);
  const s = Number(line.sgstRate);
  const i = Number(line.igstRate);
  return Math.round((c + s + i) * 100) / 100;
}

export async function buildGstr1(
  period: Period,
  options: { gstin?: string } = {}
): Promise<Gstr1Document> {
  const merchantGstin =
    options.gstin ?? process.env.MERCHANT_GSTIN ?? "00AAAAA0000A1Z5";

  // Filing period MMYYYY from period.from
  const [yr, mo] = period.from.split("-");
  const fp = `${mo}${yr}`;

  const conds = [
    gte(invoices.postingDate, period.from),
    lte(invoices.postingDate, period.to),
    sql`${invoices.status} != 'cancelled'`,
  ];

  const allInvoices = await db
    .select({
      inv: invoices,
      parent: parents,
      orderSchoolId: orders.schoolId,
    })
    .from(invoices)
    .innerJoin(parents, eq(parents.id, invoices.parentId))
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(and(...conds));

  if (allInvoices.length === 0) {
    return {
      gstin: merchantGstin,
      fp,
      gt: 0,
      cur_gt: 0,
      b2b: [],
      b2cl: [],
      b2cs: [],
      hsn: { data: [] },
      cdnr: [],
      cdnur: [],
    };
  }

  const invoiceIds = allInvoices.map((r) => r.inv.id);
  const allItems = await db
    .select()
    .from(invoiceItems)
    .where(inArray(invoiceItems.invoiceId, invoiceIds));
  const itemsByInvoice = new Map<string, (typeof invoiceItems.$inferSelect)[]>();
  for (const it of allItems) {
    const arr = itemsByInvoice.get(it.invoiceId) ?? [];
    arr.push(it);
    itemsByInvoice.set(it.invoiceId, arr);
  }

  const b2b: B2BInvoice[] = [];
  const b2cl: B2CLInvoice[] = [];
  const b2csMap = new Map<string, B2CSEntry>(); // key: pos|rt|sply_ty
  const hsnMap = new Map<string, HSNEntry>();
  const cdnr: B2BInvoice[] = [];

  let curGt = 0;

  for (const row of allInvoices) {
    const inv = row.inv;
    const items = itemsByInvoice.get(inv.id) ?? [];
    const ctin = inv.customerGstin;
    const isReg = !!ctin;
    const isReturn = inv.isReturn;
    const pos = (inv.placeOfSupply ?? "").split("-")[0] || "00"; // "36-Telangana" → "36"
    curGt += inv.netTotal;

    // ── B2B / CDNR (registered customers) ─────────────
    if (isReg) {
      const target = isReturn ? cdnr : b2b;
      target.push({
        ctin: ctin!,
        inv: [
          {
            inum: inv.invoiceNumber,
            idt: fmtDate(inv.postingDate),
            val: inv.grandTotal / 100,
            pos,
            rchrg: "N",
            inv_typ: "R",
            itms: items.map((line, idx) => ({
              num: idx + 1,
              itm_det: {
                rt: combinedRate(line),
                txval: line.taxableAmount / 100,
                iamt: line.igstAmount / 100,
                camt: line.cgstAmount / 100,
                samt: line.sgstAmount / 100,
                csamt: 0,
              },
            })),
          },
        ],
      });
      continue;
    }

    // ── B2CL (unregistered, inter-state, > ₹2.5L) ─────
    const isInterState = items.some((l) => Number(l.igstRate) > 0);
    if (isInterState && inv.grandTotal > 2_50_000 * 100) {
      b2cl.push({
        pos,
        inv: [
          {
            inum: inv.invoiceNumber,
            idt: fmtDate(inv.postingDate),
            val: inv.grandTotal / 100,
            itms: items.map((line, idx) => ({
              num: idx + 1,
              itm_det: {
                rt: combinedRate(line),
                txval: line.taxableAmount / 100,
                iamt: line.igstAmount / 100,
                csamt: 0,
              },
            })),
          },
        ],
      });
      continue;
    }

    // ── B2CS (everything else — small B2C, aggregated) ────
    for (const line of items) {
      const rt = combinedRate(line);
      const sply_ty: "INTRA" | "INTER" = isInterState ? "INTER" : "INTRA";
      const key = `${pos}|${rt}|${sply_ty}`;
      const existing = b2csMap.get(key);
      if (existing) {
        existing.txval += line.taxableAmount / 100;
        existing.iamt += line.igstAmount / 100;
        existing.camt += line.cgstAmount / 100;
        existing.samt += line.sgstAmount / 100;
      } else {
        b2csMap.set(key, {
          sply_ty,
          pos,
          rt,
          txval: line.taxableAmount / 100,
          iamt: line.igstAmount / 100,
          camt: line.cgstAmount / 100,
          samt: line.sgstAmount / 100,
          csamt: 0,
          typ: "OE",
        });
      }
    }

    // ── HSN summary (mandatory section 12) ────────────
    for (const line of items) {
      const hsn = line.hsnCode ?? "";
      const key = hsn;
      const existing = hsnMap.get(key);
      const rt = combinedRate(line);
      if (existing) {
        existing.qty += line.qty;
        existing.val += line.totalAmount / 100;
        existing.txval += line.taxableAmount / 100;
        existing.iamt += line.igstAmount / 100;
        existing.camt += line.cgstAmount / 100;
        existing.samt += line.sgstAmount / 100;
      } else {
        hsnMap.set(key, {
          num: hsnMap.size + 1,
          hsn_sc: hsn,
          desc: line.itemNameSnapshot.slice(0, 30),
          uqc: "PCS-PIECES",
          qty: line.qty,
          val: line.totalAmount / 100,
          txval: line.taxableAmount / 100,
          iamt: line.igstAmount / 100,
          camt: line.cgstAmount / 100,
          samt: line.sgstAmount / 100,
          csamt: 0,
        });
      }
    }
  }

  return {
    gstin: merchantGstin,
    fp,
    gt: 0,
    cur_gt: Math.round(curGt / 100),
    b2b,
    b2cl,
    b2cs: Array.from(b2csMap.values()),
    hsn: { data: Array.from(hsnMap.values()) },
    cdnr,
    cdnur: [],
  };
}
