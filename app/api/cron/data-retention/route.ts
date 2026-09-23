import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { and, isNotNull, lt, sql } from "drizzle-orm";
import { dbCron as db } from "@/db/client";
import { activityLog, communications, otpLogs } from "@/db/schema";

/**
 * GET/POST /api/cron/data-retention
 *
 * The retention schedule from the Data Protection & Privacy document,
 * Section 6 ("How long we keep it"), as a list of RULES. Each rule can
 * COUNT the rows it would touch; most can also APPLY the change.
 *
 * Two kinds of rule (owner decision, 2026-09-23):
 *
 *   autoApply = true   apply() runs on EVERY tick, whatever the env says.
 *                      R1 (otp rows > 90 d), R2 (otp codes > 24 h),
 *                      R6 (inactive parents → anonymise).
 *   autoApply = false  apply() runs only when RETENTION_APPLY is exactly
 *                      "1"; otherwise the rule only counts (`wouldAffect`).
 *                      R3 R4 R5 R7 R8; R9 has no apply at all (returns null).
 *
 * Per rule the response carries
 *   { id, label, retention, mode: "applied" | "dry-run", affected | wouldAffect }
 * plus `error` when a rule threw (one broken count never hides the rest).
 *
 *   ?only=<ruleId>   run a single rule (e.g. ?only=R2)
 *   ?dry=1           count only, for every rule (preview before the nightly run)
 *
 * Auth: `Authorization: Bearer <CRON_TOKEN>` (server/cron-auth.ts).
 * Recommended cadence: nightly (deploy/erp-cron.example → 02:40).
 *
 * Date binding: typed Drizzle operators (lt/gte with a Date) or a sql``
 * fragment with an ISO STRING cast `::timestamptz` — never a raw JS Date
 * inside sql`` (postgres.js cannot bind it; see cleanup-carts).
 *
 * Storage note (R5): this pass blanks the `photos` column only. The objects
 * themselves (S3/R2 or public/uploads) are NOT removed here — that needs
 * the private-storage move (DPP action P-02) first, so the same key list
 * can drive a delete against the right bucket.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB = "data-retention";
const LOCK_TTL_SECONDS = 600;

type Rule = {
  id: string;
  label: string;
  basis: string;
  retention: string;
  /** true ⇒ apply() runs every tick regardless of RETENTION_APPLY. */
  autoApply: boolean;
  count: () => Promise<number>;
  /** Returns rows affected, or null when the rule has no apply at all. */
  apply?: () => Promise<number | null>;
};

// ─── helpers ──────────────────────────────────────────────────────────

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** `count(*)` comes back as a bigint → string from postgres.js. */
async function countSql(query: ReturnType<typeof sql>): Promise<number> {
  const rows = rowsOf<{ n: string | number | null }>(await db.execute(query));
  return Number(rows[0]?.n ?? 0);
}

/** Rows touched by a DELETE/UPDATE written as `WITH x AS (... RETURNING 1) SELECT count(*)`. */
async function affectedSql(query: ReturnType<typeof sql>): Promise<number> {
  return countSql(query);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function yearsAgo(years: number): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

/** ISO string for sql`` fragments (`${iso}::timestamptz`). */
function iso(d: Date): string {
  return d.toISOString();
}

/**
 * Indian financial year runs 1 April → 31 March. Orders in the FY that
 * started in year Y are "8 years past the FY end" once we are on/after
 * 1 April (Y + 9). So everything created before 1 April (currentFyStart − 8)
 * IST is eligible.
 */
function ordersEightYearCutoffIso(now = new Date()): string {
  // IST = UTC+05:30; shift so month/year are read in IST.
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-based; April = 3
  const currentFyStart = m >= 3 ? y : y - 1;
  const cutoffFyStart = currentFyStart - 8;
  return `${cutoffFyStart}-04-01T00:00:00+05:30`;
}

// Shared predicates so count() and apply() can never drift apart.

const INACTIVE_PARENT_WHERE = () => sql`
  coalesce(p.last_login_at, p.created_at) < ${iso(yearsAgo(3))}::timestamptz
  AND NOT EXISTS (SELECT 1 FROM students s WHERE s.parent_id = p.id AND s.enabled = true)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.parent_id = p.id)
  AND p.name IS DISTINCT FROM 'Deleted parent'
  AND p.phone NOT LIKE 'del-%'`;

const LEAVER_STUDENT_WHERE = () => sql`
  s.enabled = false
  AND s.disabled_by_closure = false
  AND coalesce(s.erp_modified, s.synced_at, s.created_at) < ${iso(yearsAgo(1))}::timestamptz
  AND s.name IS DISTINCT FROM 'Former student'`;

const PHOTOS_NON_EMPTY = sql`photos IS NOT NULL AND photos <> '[]'::jsonb AND photos <> 'null'::jsonb`;

// ─── the schedule (DPP §6) ────────────────────────────────────────────

const RULES: Rule[] = [
  {
    id: "R1",
    label: "otp-logs",
    basis: "otp_logs.created_at",
    retention: "90 days (phone, outcome, error kept only to diagnose SMS delivery)",
    autoApply: true,
    count: () =>
      countSql(sql`SELECT count(*) AS n FROM otp_logs WHERE created_at < ${iso(daysAgo(90))}::timestamptz`),
    apply: async () => {
      const deleted = await db
        .delete(otpLogs)
        .where(lt(otpLogs.createdAt, daysAgo(90)))
        .returning({ id: otpLogs.id });
      return deleted.length;
    },
  },
  {
    id: "R2",
    label: "otp-codes",
    basis: "otp_logs.otp_code where created_at older than 24 hours",
    retention: "24 hours — OTPs are valid 5 min, support only needs a same-day reveal (DPP P-01)",
    autoApply: true,
    count: () =>
      countSql(
        sql`SELECT count(*) AS n FROM otp_logs
             WHERE otp_code IS NOT NULL AND created_at < now() - interval '1 day'`,
      ),
    apply: async () => {
      const updated = await db
        .update(otpLogs)
        .set({ otpCode: null })
        .where(and(isNotNull(otpLogs.otpCode), lt(otpLogs.createdAt, daysAgo(1))))
        .returning({ id: otpLogs.id });
      return updated.length;
    },
  },
  {
    id: "R3",
    label: "activity-log",
    basis: "activity_log.created_at",
    retention: "2 years online; 'archive-only' after that is satisfied by the nightly encrypted backup",
    autoApply: false,
    count: () =>
      countSql(sql`SELECT count(*) AS n FROM activity_log WHERE created_at < ${iso(yearsAgo(2))}::timestamptz`),
    apply: async () => {
      const deleted = await db
        .delete(activityLog)
        .where(lt(activityLog.createdAt, yearsAgo(2)))
        .returning({ id: activityLog.id });
      return deleted.length;
    },
  },
  {
    id: "R4",
    label: "communications",
    // The table has no created_at; occurred_at (defaultNow) is the row's timestamp.
    basis: "communications.occurred_at",
    retention: "2 years (proof of what was sent)",
    autoApply: false,
    count: () =>
      countSql(
        sql`SELECT count(*) AS n FROM communications WHERE occurred_at < ${iso(yearsAgo(2))}::timestamptz`,
      ),
    apply: async () => {
      const deleted = await db
        .delete(communications)
        .where(lt(communications.occurredAt, yearsAgo(2)))
        .returning({ id: communications.id });
      return deleted.length;
    },
  },
  {
    id: "R5",
    label: "request-photos",
    basis:
      "returns.status IN (rejected, refunded, received) / missing_item_claims.status IN (rejected, delivered, completed, exchange_completed) / concerns.status = resolved; updated_at older than 180 days; photos non-empty",
    retention:
      "180 days after the request closes (column blanked; storage objects NOT deleted in this pass — needs P-02)",
    autoApply: false,
    count: async () => {
      const cutoff = iso(daysAgo(180));
      const [a, b, c] = await Promise.all([
        countSql(sql`
          SELECT count(*) AS n FROM returns
           WHERE status IN ('rejected', 'refunded', 'received')
             AND updated_at < ${cutoff}::timestamptz AND ${PHOTOS_NON_EMPTY}`),
        countSql(sql`
          SELECT count(*) AS n FROM missing_item_claims
           WHERE status IN ('rejected', 'delivered', 'completed', 'exchange_completed')
             AND updated_at < ${cutoff}::timestamptz AND ${PHOTOS_NON_EMPTY}`),
        countSql(sql`
          SELECT count(*) AS n FROM concerns
           WHERE status = 'resolved'
             AND updated_at < ${cutoff}::timestamptz AND ${PHOTOS_NON_EMPTY}`),
      ]);
      return a + b + c;
    },
    apply: async () => {
      const cutoff = iso(daysAgo(180));
      const a = await affectedSql(sql`
        WITH x AS (
          UPDATE returns SET photos = '[]'::jsonb
           WHERE status IN ('rejected', 'refunded', 'received')
             AND updated_at < ${cutoff}::timestamptz AND ${PHOTOS_NON_EMPTY}
          RETURNING 1)
        SELECT count(*) AS n FROM x`);
      const b = await affectedSql(sql`
        WITH x AS (
          UPDATE missing_item_claims SET photos = '[]'::jsonb
           WHERE status IN ('rejected', 'delivered', 'completed', 'exchange_completed')
             AND updated_at < ${cutoff}::timestamptz AND ${PHOTOS_NON_EMPTY}
          RETURNING 1)
        SELECT count(*) AS n FROM x`);
      const c = await affectedSql(sql`
        WITH x AS (
          UPDATE concerns SET photos = '[]'::jsonb
           WHERE status = 'resolved'
             AND updated_at < ${cutoff}::timestamptz AND ${PHOTOS_NON_EMPTY}
          RETURNING 1)
        SELECT count(*) AS n FROM x`);
      return a + b + c;
    },
  },
  {
    id: "R6",
    label: "inactive-parents",
    basis:
      "parents with no enabled student, no order ever, coalesce(last_login_at, created_at) older than 3 years, not already anonymised",
    retention:
      "3 years; then anonymise in place: name 'Deleted parent', email NULL, password_hash NULL, notes NULL, phone 'del-' + first 8 chars of id (varchar(15), unique). The same phone is scrubbed from student_guardian_links (phone_no, email, guardian_name) and guardians (mobile/alternate number) unless another live parent still uses it",
    autoApply: true,
    count: () => countSql(sql`SELECT count(*) AS n FROM parents p WHERE ${INACTIVE_PARENT_WHERE()}`),
    apply: () =>
      affectedSql(sql`
        WITH tgt AS (
          SELECT p.id, right(regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g'), 10) AS n10
            FROM parents p
           WHERE ${INACTIVE_PARENT_WHERE()}
             -- parents_phone_idx is UNIQUE: skip (never fail on) a prefix collision
             AND NOT EXISTS (SELECT 1 FROM parents q WHERE q.phone = 'del-' || left(p.id::text, 8))
        ),
        x AS (
          UPDATE parents p
             SET name = 'Deleted parent',
                 email = NULL,
                 password_hash = NULL,
                 notes = NULL,
                 phone = 'del-' || left(p.id::text, 8)
            FROM tgt WHERE p.id = tgt.id
          RETURNING tgt.n10
        ),
        -- the phone lives on in the family graph; scrub it there too, unless
        -- a different, still-live parent row owns the same number
        orphan AS (
          SELECT n10 FROM x
           WHERE n10 <> ''
             AND NOT EXISTS (
               SELECT 1 FROM parents q
                WHERE right(regexp_replace(coalesce(q.phone, ''), '\\D', '', 'g'), 10) = x.n10)
        ),
        l AS (
          UPDATE student_guardian_links g
             SET phone_no = 'del-' || left(g.id::text, 8), email = NULL, guardian_name = NULL
           WHERE right(regexp_replace(coalesce(g.phone_no, ''), '\\D', '', 'g'), 10) IN (SELECT n10 FROM orphan)
          RETURNING 1
        ),
        m AS (
          UPDATE guardians gu
             SET mobile_number = CASE WHEN right(regexp_replace(coalesce(gu.mobile_number, ''), '\\D', '', 'g'), 10) IN (SELECT n10 FROM orphan) THEN NULL ELSE gu.mobile_number END,
                 alternate_number = CASE WHEN right(regexp_replace(coalesce(gu.alternate_number, ''), '\\D', '', 'g'), 10) IN (SELECT n10 FROM orphan) THEN NULL ELSE gu.alternate_number END
           WHERE right(regexp_replace(coalesce(gu.mobile_number, ''), '\\D', '', 'g'), 10) IN (SELECT n10 FROM orphan)
              OR right(regexp_replace(coalesce(gu.alternate_number, ''), '\\D', '', 'g'), 10) IN (SELECT n10 FROM orphan)
          RETURNING 1
        )
        SELECT count(*) AS n FROM x`),
  },
  {
    id: "R7",
    label: "leaver-students",
    basis:
      "students.enabled = false AND disabled_by_closure = false, last touched (coalesce(erp_modified, synced_at, created_at)) more than 1 year ago. NOTE: `students` carries no leaver flag or updated_at; the roster's leaver mark lives only in mcb_students.raw->>'Status1' <> 'Active', so disabled-and-untouched is the proxy",
    retention: "1 year after leaving; then anonymise name + drop dob/email/mobile/blood group/picture",
    autoApply: false,
    count: () => countSql(sql`SELECT count(*) AS n FROM students s WHERE ${LEAVER_STUDENT_WHERE()}`),
    apply: () =>
      affectedSql(sql`
        WITH x AS (
          UPDATE students s
             SET name = 'Former student',
                 first_name = NULL,
                 middle_name = NULL,
                 last_name = NULL,
                 date_of_birth = NULL,
                 student_email_id = NULL,
                 student_mobile_number = NULL,
                 blood_group = NULL,
                 profile_picture_url = NULL,
                 avatar_url = NULL
           WHERE ${LEAVER_STUDENT_WHERE()}
          RETURNING 1)
        SELECT count(*) AS n FROM x`),
  },
  {
    id: "R8",
    label: "mcb-imports",
    basis:
      "current AY = max(mcb_fee_payments.raw->>'AcademicYear'); rows whose AY start year < current − 3 in mcb_fee_payments (raw->>'AcademicYear') and mcb_fee_transactions (academic_year); mcb_students has no AY column — a row qualifies when the enrolment has no fee row in a retained year AND synced_at is over 400 days old (dropped out of the nightly feed)",
    retention: "current + 3 academic years, older rows deleted (schools' own retention governs; Inventre is a processor)",
    autoApply: false,
    count: async () => {
      const keepFrom = await mcbKeepFromYear();
      if (keepFrom === null) return 0; // nothing imported yet (or an unparseable label)
      const [a, b, c] = await Promise.all([
        countSql(sql`
          SELECT count(*) AS n FROM mcb_fee_payments
           WHERE (substring(raw->>'AcademicYear' from '^\\d{4}'))::int < ${keepFrom}`),
        countSql(sql`
          SELECT count(*) AS n FROM mcb_fee_transactions
           WHERE (substring(academic_year from '^\\d{4}'))::int < ${keepFrom}`),
        countSql(sql`SELECT count(*) AS n FROM mcb_students ms WHERE ${mcbStaleStudentWhere(keepFrom)}`),
      ]);
      return a + b + c;
    },
    apply: async () => {
      const keepFrom = await mcbKeepFromYear();
      if (keepFrom === null) return 0;
      const a = await affectedSql(sql`
        WITH x AS (
          DELETE FROM mcb_fee_payments
           WHERE (substring(raw->>'AcademicYear' from '^\\d{4}'))::int < ${keepFrom}
          RETURNING 1)
        SELECT count(*) AS n FROM x`);
      const b = await affectedSql(sql`
        WITH x AS (
          DELETE FROM mcb_fee_transactions
           WHERE (substring(academic_year from '^\\d{4}'))::int < ${keepFrom}
          RETURNING 1)
        SELECT count(*) AS n FROM x`);
      const c = await affectedSql(sql`
        WITH x AS (
          DELETE FROM mcb_students ms WHERE ${mcbStaleStudentWhere(keepFrom)}
          RETURNING 1)
        SELECT count(*) AS n FROM x`);
      return a + b + c;
    },
  },
  {
    id: "R9",
    label: "orders-8y",
    basis:
      "orders.created_at before 1 April of (current FY start − 8) IST, i.e. 8 years past the end of the order's financial year",
    retention:
      "8 years from FY end (GST / Income-tax), then anonymise the parent link and address — apply NOT implemented",
    autoApply: false,
    count: () =>
      countSql(
        sql`SELECT count(*) AS n FROM orders WHERE created_at < ${ordersEightYearCutoffIso()}::timestamptz`,
      ),
    apply: async () => null,
  },
];

/** First year to KEEP for the MCB tables (current AY start year − 3), or null when unknown. */
async function mcbKeepFromYear(): Promise<number | null> {
  const ayRows = rowsOf<{ ay: string | null }>(
    await db.execute(sql`SELECT max(raw->>'AcademicYear') AS ay FROM mcb_fee_payments`),
  );
  const currentAy = ayRows[0]?.ay ?? null;
  const startYear = currentAy ? Number((currentAy.match(/^\d{4}/) ?? [])[0]) : NaN;
  return Number.isFinite(startYear) ? startYear - 3 : null;
}

function mcbStaleStudentWhere(keepFrom: number) {
  return sql`
    ms.synced_at < ${iso(daysAgo(400))}::timestamptz
    AND NOT EXISTS (
      SELECT 1 FROM mcb_fee_payments f
       WHERE f.enrolment_number = ms.enrolment_number
         AND (substring(f.raw->>'AcademicYear' from '^\\d{4}'))::int >= ${keepFrom})
    AND NOT EXISTS (
      SELECT 1 FROM mcb_fee_transactions t
       WHERE t.enrolment_number = ms.enrolment_number
         AND (substring(t.academic_year from '^\\d{4}'))::int >= ${keepFrom})`;
}

// ─── route ────────────────────────────────────────────────────────────

type RuleResult = {
  id: string;
  label: string;
  retention: string;
  mode: "applied" | "dry-run";
  wouldAffect?: number;
  affected?: number | null;
  error?: string;
};

async function run(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock(JOB, LOCK_TTL_SECONDS);
  if (!lock) return cronLockedResponse(JOB);
  try {
    const envApply = process.env.RETENTION_APPLY === "1";
    const params = new URL(req.url).searchParams;
    const only = params.get("only")?.trim() || null;
    // ?dry=1 forces count-only for EVERY rule, including autoApply ones —
    // the way to preview tonight's numbers before the scheduled run.
    const forceDry = params.get("dry") === "1";
    const selected = only ? RULES.filter((r) => r.id === only || r.label === only) : RULES;
    if (only && selected.length === 0) {
      return NextResponse.json(
        { ok: false, error: `unknown rule ${only}`, known: RULES.map((r) => r.id) },
        { status: 400 },
      );
    }

    const ranAt = new Date().toISOString();
    const results: RuleResult[] = [];
    for (const rule of selected) {
      const shouldApply = !forceDry && !!rule.apply && (rule.autoApply || envApply);
      const out: RuleResult = {
        id: rule.id,
        label: rule.label,
        retention: rule.retention,
        mode: shouldApply ? "applied" : "dry-run",
      };
      try {
        if (shouldApply && rule.apply) {
          out.affected = await rule.apply();
        } else {
          out.wouldAffect = await rule.count();
        }
      } catch (err) {
        out.error = err instanceof Error ? err.message : String(err);
      }
      results.push(out);
    }

    const summary = results
      .map((r) =>
        r.error
          ? `${r.id}:ERR`
          : r.mode === "applied"
            ? `${r.id}:applied=${r.affected ?? "n/a"}`
            : `${r.id}:would=${r.wouldAffect}`,
      )
      .join(" ");
    console.log(`[data-retention] env=${envApply ? "apply" : "dry-run"} ${summary}`);

    return NextResponse.json({
      ok: results.every((r) => !r.error),
      mode: envApply ? "apply" : "dry-run",
      ranAt,
      rules: results,
    });
  } finally {
    await lock.release();
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
