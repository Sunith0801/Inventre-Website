import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getFeesViewer, viewerHas } from "@/lib/fees-auth";
import { lookupReceipts } from "@/lib/mcb/receipts";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * A printable receipt document.
 *
 * MCB issues no receipt PDF — no endpoint in their API returns one — so this
 * renders the receipt from the imported transaction lines instead. One
 * receipt number routinely settles several fee heads (a single card swipe
 * paying Terms 1–3 arrives as three rows), which is exactly why the ledger
 * panel lists lines and this page groups them back into one document with
 * one total.
 *
 * It is explicitly NOT the school's official receipt — MCB issued that. The
 * footer says so, so a printed copy can never be mistaken for one.
 *
 * Lookup goes through lib/mcb/receipts.ts, the same path the ledger panel
 * uses: stored copy first, live MCB fallback for a student the nightly
 * importer has not reached. Reading the table directly here was a bug — the
 * panel would show a receipt that this page then called "not found".
 *
 * Print-to-PDF is the export path: @media print strips the page to the
 * document, so the browser's own PDF writer produces a clean file on any
 * device without a PDF library in the app.
 */

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return String(d).slice(0, 10);
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

/** Amount in words — an Indian receipt is not a receipt without it. */
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
}
function inWords(n: number): string {
  n = Math.round(n);
  if (n === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  const lakh = Math.floor((n % 1e7) / 1e5);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  const thousand = Math.floor((n % 1e5) / 1e3);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  const hundred = Math.floor((n % 1e3) / 100);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  const rest = n % 100;
  if (rest) parts.push(twoDigits(rest));
  return `${parts.join(" ")} Rupees Only`;
}

const BRANCH_NAMES: Record<string, string> = {
  "52": "St. Andrews School, Keesara",
  "70": "St. Andrews High School, Suchitra",
  "230": "St. Michaels School, Alwal",
  "225": "Winmore Academy, Jakkur",
  "226": "Winmore Academy, Whitefield",
  "102": "Crimson Anisha Global School, Marunji",
  "103": "Crimson Anisha Global School, Undri",
};

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ receiptNo: string }>;
  searchParams: Promise<{ enrolment?: string }>;
}) {
  const viewer = await getFeesViewer();
  const { receiptNo: raw } = await params;
  const { enrolment: enrolmentParam } = await searchParams;
  const receiptNo = decodeURIComponent(raw).slice(0, 64);
  if (!viewerHas(viewer, "fees.read", "fees.write", "mcb.read", "mcb.write")) {
    redirect(`/fees/login?from=${encodeURIComponent(`/fees/receipt/${receiptNo}`)}`);
  }

  // A receipt number is only unique within a school, so the enrolment is
  // what pins it — and it is also what the receipt lookup is keyed by, so
  // the ledger always passes it.
  const enrolment = (enrolmentParam ?? "").trim().slice(0, 64) || null;

  type Line = {
    receipt_no: string | null;
    enrolment_number: string;
    paid_date: string | null;
    amount: number;
    fee_type: string | null;
    payment_mode: string | null;
    transaction_id: string | null;
    academic_year: string | null;
    branch_id: number | null;
  };
  let lines: Line[] = [];

  if (enrolment) {
    const found = await lookupReceipts(enrolment);
    lines = found.receipts
      .filter((x) => x.receiptNo === receiptNo)
      .map((x) => ({
        receipt_no: x.receiptNo,
        enrolment_number: enrolment,
        paid_date: x.paidDate,
        amount: x.amount,
        fee_type: x.feeType,
        payment_mode: x.mode,
        transaction_id: x.transactionId,
        academic_year: x.academicYear,
        branch_id: x.branchId ?? null,
      }))
      .sort((a, b) => (a.fee_type ?? "").localeCompare(b.fee_type ?? ""));
  } else {
    // No enrolment in the URL — the live path needs one, so this can only
    // answer from the imported table.
    const res = await db.execute(sql`
      SELECT t.receipt_no, t.enrolment_number, t.paid_date, t.amount, t.fee_type,
             t.payment_mode, t.transaction_id, t.academic_year, t.branch_id
      FROM mcb_fee_transactions t
      WHERE t.receipt_no = ${receiptNo}
      ORDER BY t.fee_type
    `);
    lines = rowsOf<Record<string, unknown>>(res).map((r) => ({
      receipt_no: (r.receipt_no as string) ?? null,
      enrolment_number: String(r.enrolment_number),
      paid_date: r.paid_date ? String(r.paid_date).slice(0, 10) : null,
      amount: num(r.amount),
      fee_type: (r.fee_type as string | null) ?? null,
      payment_mode: (r.payment_mode as string | null) ?? null,
      transaction_id: (r.transaction_id as string | null) ?? null,
      academic_year: (r.academic_year as string | null) ?? null,
      branch_id: r.branch_id == null ? null : Number(r.branch_id),
    }));
  }

  // Student identity is not on the receipt rows; it comes from the master.
  const studentRes = lines.length
    ? await db.execute(sql`
        SELECT s.student_name,
               s.raw->>'ClassName'             AS class_name,
               s.raw->>'Section'               AS section,
               s.raw->>'StudentReferencesCode' AS reference_code
        FROM mcb_students s
        WHERE s.enrolment_number = ${lines[0].enrolment_number}
        LIMIT 1
      `)
    : null;
  const student = studentRes ? (rowsOf<Record<string, unknown>>(studentRes)[0] ?? {}) : {};

  if (lines.length === 0) {
    return (
      <div className="fx rc-shell">
        <div className="rc-missing">
          <div className="kicker">Receipt {receiptNo}</div>
          <h1>Not found</h1>
          <p>
            MyClassBoard has no receipt with this number
            {enrolment ? ` for ${enrolment}` : ""}. Check the number, or open the
            student in the ledger and use the receipt link there.
          </p>
          <a href="/fees">← Back to the ledger</a>
        </div>
      </div>
    );
  }

  const head = lines[0];
  const total = lines.reduce((s, l) => s + num(l.amount), 0);
  const branch = BRANCH_NAMES[String(head.branch_id)] ?? "—";
  const grade =
    [student.class_name, student.section].filter(Boolean).join(" · ") || "—";

  return (
    <div className="fx rc-shell">
      <div className="rc-actions">
        <a className="fx-page" href="/fees">← Ledger</a>
        <PrintButton />
      </div>

      <article className="rc-doc">
        <header className="rc-head">
          <div>
            <div className="kicker">{branch}</div>
            <h1 className="rc-title">Fee receipt</h1>
          </div>
          <div className="rc-no">
            <div className="kicker">Receipt no</div>
            <div className="rc-no-val">{head.receipt_no || "—"}</div>
            <div className="rc-no-date">{fmtDate(head.paid_date)}</div>
          </div>
        </header>

        <section className="rc-meta">
          <div>
            <div className="kicker">Student</div>
            <div className="rc-meta-val">{(student.student_name as string) ?? "—"}</div>
          </div>
          <div>
            <div className="kicker">Enrolment</div>
            <div className="rc-meta-val mono">
              {head.enrolment_number}
              {student.reference_code ? ` · ${student.reference_code}` : ""}
            </div>
          </div>
          <div>
            <div className="kicker">Class</div>
            <div className="rc-meta-val">{grade}</div>
          </div>
          <div>
            <div className="kicker">Academic year</div>
            <div className="rc-meta-val mono">{head.academic_year ?? "—"}</div>
          </div>
        </section>

        <table className="rc-table">
          <thead>
            <tr>
              <th>Particulars</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.fee_type ?? "—"}</td>
                <td className="num">{inr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total received</td>
              <td className="num">{inr(total)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="rc-words">{inWords(total)}</div>

        <section className="rc-pay">
          <div>
            <div className="kicker">Payment mode</div>
            <div className="rc-meta-val">{head.payment_mode ?? "—"}</div>
          </div>
          <div>
            <div className="kicker">Transaction reference</div>
            <div className="rc-meta-val mono rc-txn">{head.transaction_id ?? "—"}</div>
          </div>
        </section>

        <footer className="rc-foot">
          Computer-generated summary of the payment recorded in MyClassBoard against receipt{" "}
          {String(head.receipt_no)}. The school&rsquo;s official receipt is issued by
          MyClassBoard; this is a working copy for reference and does not require a signature.
        </footer>
      </article>
    </div>
  );
}
