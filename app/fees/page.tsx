import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getFeesViewer, viewerHas } from "@/server/fees-auth";
import FeeConsole from "./FeeConsole";

export const dynamic = "force-dynamic";

/**
 * inventre.in/fees — the MyClassBoard fee ledger.
 *
 * A single standalone dashboard: one page, its own art direction, no admin
 * chrome. It reads the MCB receivables already synced into
 * `mcb_fee_payments`; every number's derivation is documented in
 * app/api/admin/mcb/fees/route.ts, which serves every interaction here.
 *
 * Access: `fees.read` (a fee-desk account that can see this and nothing
 * else) or `mcb.read` (anyone who already administers MCB data). An
 * unauthenticated visitor is bounced to the admin login. The page shows
 * student names, phone numbers and fee balances, so it is never public.
 */

const SCHOOLS: { code: string; name: string; branch: string }[] = [
  { code: "SASKS", name: "St Andrews Keesara", branch: "St. ANDREWS SCHOOL KEESARA" },
  { code: "SASBP", name: "St Andrews Suchitra", branch: "St. ANDREWS HIGH SCHOOL SUCHITRA" },
  { code: "SMSAW", name: "St Michaels Alwal", branch: "St. MICHAELS SCHOOL[ALWAL]" },
  { code: "WMAJK", name: "Winmore Jakkur", branch: "Winmore Academy Jakkur" },
  { code: "WMAWF", name: "Winmore Whitefield", branch: "Winmore Academy Whitefield" },
  { code: "CAGSM", name: "Crimson Anisha Marunji", branch: "Crimson Anisha Global School Marunji" },
  { code: "CAGSU", name: "Crimson Anisha Undri", branch: "Crimson Anisha Global School Undri" },
];

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default async function FeesPage() {
  const me = await getFeesViewer();
  if (!viewerHas(me, "fees.read", "fees.write", "mcb.read", "mcb.write")) {
    redirect("/fees/login?from=%2Ffees");
  }

  const ayRes = await db.execute(sql`
    SELECT DISTINCT raw->>'AcademicYear' AS ay
    FROM mcb_fee_payments
    WHERE raw->>'AcademicYear' IS NOT NULL
    ORDER BY 1 DESC
  `);
  const academicYears = rowsOf<{ ay: string }>(ayRes).map((r) => r.ay);
  const ay = academicYears[0] ?? null;
  const ayFilter = ay ? sql`raw->>'AcademicYear' = ${ay}` : sql`true`;

  const [agg, sync] = await Promise.all([
    db.execute(sql`
      WITH b AS (
        SELECT
          enrolment_number,
          fee_head,
          raw->>'BranchName' AS branch,
          COALESCE(NULLIF(raw->>'InstallmentAmount', '')::numeric, 0)     AS gross,
          COALESCE(NULLIF(raw->>'Concession', '')::numeric, 0)            AS concession,
          COALESCE(NULLIF(raw->>'InstallmentPaidAmount', '')::numeric, 0) AS paid,
          -- Same rule as the API: Status1 is the STUDENT's enrolment status,
          -- so a leaver's billing and payments stay in the totals while
          -- their balance drops out of Outstanding. See the long note in
          -- app/api/admin/mcb/fees/route.ts.
          (COALESCE(raw->>'Status1', 'Active') <> 'Active')               AS has_left
        FROM mcb_fee_payments
        WHERE ${ayFilter}
      )
      SELECT branch,
             count(DISTINCT enrolment_number)
               FILTER (WHERE NOT has_left)::int                  AS students,
             count(DISTINCT fee_head)::int                      AS heads,
             sum(gross)                                         AS gross,
             sum(concession)                                    AS concession,
             sum(paid)                                          AS paid,
             sum(GREATEST(gross - concession - paid, 0))
               FILTER (WHERE NOT has_left)                      AS balance,
             count(DISTINCT enrolment_number) FILTER (
               WHERE NOT has_left AND gross - concession - paid > 0)::int
                                                                AS pending_students,
             count(DISTINCT enrolment_number) FILTER (
               WHERE has_left)::int                             AS left_students,
             sum(GREATEST(gross - concession - paid, 0))
               FILTER (WHERE has_left)                          AS left_balance
      FROM b GROUP BY branch
    `),
    db.execute(sql`
      SELECT MAX(synced_at) AS fees_last_synced,
             MAX(payment_date) AS last_receipt
      FROM mcb_fee_payments
    `),
  ]);

  const byBranch = new Map(
    rowsOf<Record<string, unknown>>(agg).map((r) => [String(r.branch), r])
  );
  const s = rowsOf<{ fees_last_synced: string | null; last_receipt: string | null }>(sync)[0];

  return (
    <FeeConsole
      currentEmail={me?.email ?? ""}
      canManageUsers={viewerHas(me, "fees-users.write")}
      academicYears={academicYears}
      initialAy={ay}
      lastSynced={s?.fees_last_synced ?? null}
      lastReceipt={s?.last_receipt ?? null}
      initialSchools={SCHOOLS.map((sc) => {
        const r = byBranch.get(sc.branch);
        const gross = num(r?.gross);
        const concession = num(r?.concession);
        return {
          code: sc.code,
          name: sc.name,
          students: num(r?.students),
          heads: num(r?.heads),
          gross,
          concession,
          net: gross - concession,
          paid: num(r?.paid),
          balance: num(r?.balance),
          pendingStudents: num(r?.pending_students),
          leftStudents: num(r?.left_students),
          leftBalance: num(r?.left_balance),
        };
      })}
    />
  );
}
