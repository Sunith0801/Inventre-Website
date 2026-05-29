/**
 * "Forgot my mobile number" — search students by school + grade + a name
 * fragment (>= 3 chars). Returns the registered mobile MASKED (only the
 * last 4 digits) so the parent can recognise their own record.
 *
 *   GET ?school=<code>&grade=<name>&q=<name fragment>
 *     → { results: [{ studentId, name, enrollment, school, mobileMasked }] }
 */
import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimit } from "@/lib/rate-limit";

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
}
function maskPhone(p: string | null): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length < 4) return "—";
  return "••••••" + d.slice(-4);
}

// Relations we surface as a label on the result card. Anything else
// (Guardian/Self/blank/unknown) renders without a label.
const KNOWN_RELATIONS = new Set(["Father", "Mother"]);
function normaliseRelation(r: string | null | undefined): "Father" | "Mother" | null {
  const t = (r ?? "").trim();
  if (!t) return null;
  const titleCase = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return KNOWN_RELATIONS.has(titleCase) ? (titleCase as "Father" | "Mother") : null;
}

export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-search:${ip}`,
    max: 40,
    windowSeconds: 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many searches. Try again shortly." },
      { status: 429 }
    );

  const url = new URL(req.url);
  const school = (url.searchParams.get("school") ?? "").trim();
  const grade = (url.searchParams.get("grade") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!school || !grade) {
    return NextResponse.json(
      { error: "Select your school and grade first." },
      { status: 400 }
    );
  }
  if (q.length < 3) {
    return NextResponse.json(
      { error: "Enter at least 3 characters of the student's name or last 4 digits of the mobile number." },
      { status: 400 }
    );
  }

  // Each whitespace-separated token must match somewhere — either against the
  // name (word-order independent, with pg_trgm fuzzy fallback so typos like
  // "soonith" still surface "Sunith") or against the last 4 digits of the
  // guardian/parent phone when the token looks like a digit run.
  const tokens = q.split(/\s+/).filter(Boolean);
  const phoneDigits = (col: string) =>
    sql`right(regexp_replace(COALESCE(${sql.raw(col)}, ''), '\D', '', 'g'), 4)`;
  const tokenConditions: SQL[] = tokens.map((tok) => {
    const digits = tok.replace(/\D/g, "");
    if (digits.length >= 4) {
      const last4 = digits.slice(-4);
      // Match against ANY guardian phone on file (not just row#0) so a parent
      // who's used Mom's number historically can still recognise their child.
      return sql`(
        ${phoneDigits("p.phone")} = ${last4}
        OR EXISTS (
          SELECT 1 FROM student_guardian_links x2
          WHERE x2.student_id = s.id
            AND right(regexp_replace(COALESCE(x2.phone_no, ''), '\D', '', 'g'), 4) = ${last4}
        )
      )`;
    }
    // Substring match OR pg_trgm similarity (>= 0.2 — looser than the
    // operator default of 0.3 so a 3-letter typo fragment still surfaces the
    // right student; the school+grade filter already narrows the candidate
    // set so the linear scan is fine without the trigram index).
    const like = `%${tok}%`;
    return sql`(s.name ILIKE ${like} OR similarity(s.name, ${tok}) >= 0.2)`;
  });
  const whereTokens = tokenConditions.length
    ? sql` AND (${sql.join(tokenConditions, sql` AND `)})`
    : sql``;
  // Relevance: rank by best trigram similarity of any name-like token against
  // the full name (digit-only tokens contribute 0). Falls back to alphabetical
  // when scores tie.
  const nameTokens = tokens.filter((t) => t.replace(/\D/g, "").length < 4);
  const relevance = nameTokens.length
    ? sql`GREATEST(${sql.join(
        nameTokens.map((t) => sql`similarity(s.name, ${t})`),
        sql`, `,
      )})`
    : sql`0::real`;

  const results = rows<{
    student_id: string;
    name: string | null;
    enrollment: string | null;
    school_name: string | null;
    parent_phone: string | null;
    phones: { phone: string | null; relation: string | null; row_idx: number }[] | null;
  }>(
    await db.execute(sql`
      SELECT s.id AS student_id,
             s.name,
             s.enrollment_number AS enrollment,
             COALESCE(NULLIF(sc.school_name,''), NULLIF(sc.name,''), s.school_code) AS school_name,
             p.phone AS parent_phone,
             -- All guardian phones for the student, ordered by row_idx so the
             -- primary (typically Father) appears first.
             (
               SELECT COALESCE(
                 jsonb_agg(jsonb_build_object(
                   'phone', x.phone_no, 'relation', x.relation, 'row_idx', x.row_idx
                 ) ORDER BY x.row_idx),
                 '[]'::jsonb
               )
               FROM student_guardian_links x
               WHERE x.student_id = s.id
                 AND x.phone_no IS NOT NULL AND x.phone_no <> ''
             ) AS phones,
             ${relevance} AS _score
      FROM students s
      LEFT JOIN schools sc ON sc.school_code = s.school_code
      LEFT JOIN parents p ON p.id = s.parent_id
      WHERE s.school_code = ${school}
        AND s.grade = ${grade}${whereTokens}
      ORDER BY _score DESC, s.name
      LIMIT 25
    `)
  );

  // Build a deduped list of {relation,last4} per student, preserving row_idx
  // order. Include parents.phone as a fallback when there are no guardian
  // links (legacy single-parent records).
  function last10(p: string | null | undefined): string {
    return (p ?? "").replace(/\D/g, "").slice(-10);
  }

  return NextResponse.json({
    results: results.map((r) => {
      const seen = new Set<string>();
      const phones: { relation: "Father" | "Mother" | null; mobileMasked: string }[] = [];
      for (const row of r.phones ?? []) {
        const ten = last10(row.phone);
        if (ten.length !== 10 || seen.has(ten)) continue;
        seen.add(ten);
        phones.push({
          relation: normaliseRelation(row.relation),
          mobileMasked: maskPhone(row.phone),
        });
      }
      const parentTen = last10(r.parent_phone);
      if (parentTen.length === 10 && !seen.has(parentTen)) {
        seen.add(parentTen);
        phones.push({ relation: null, mobileMasked: maskPhone(r.parent_phone) });
      }
      return {
        studentId: r.student_id,
        name: r.name ?? "—",
        enrollment: r.enrollment ?? "—",
        school: r.school_name ?? "—",
        phones,
        // Backwards-compatible single-phone field for callers that haven't
        // migrated yet — first phone in the list, or '—'.
        mobileMasked: phones[0]?.mobileMasked ?? "—",
      };
    }),
  });
}
