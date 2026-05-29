/**
 * Pull every `Website Cart Coupon` from erp.inventre.in into the local
 * `website_cart_coupons` table. Idempotent: re-runs upsert on erp_name.
 *
 *   npx tsx scripts/import-website-cart-coupons.ts
 *
 * Linked School / Student are stored both verbatim (erp name string) and as
 * resolved local FKs via schools.erp_name / students.erp_name when found.
 */
import postgres from "postgres";

const ERP = process.env.ERP_BASE_URL ?? "https://erp.inventre.in";
const TOKEN =
  process.env.ERP_API_TOKEN ??
  `${process.env.ERP_API_KEY ?? "368aba31f063d55"}:${process.env.ERP_API_SECRET ?? "3f45e93d2419d2a"}`;
const DB_URL =
  process.env.DATABASE_DIRECT_URL ??
  "postgres://inventre:inventre_prod@161.97.132.211:55433/inventre";

const sql = postgres(DB_URL, { prepare: false });

type Coupon = {
  name: string;
  coupon_code: string;
  is_active: number;
  school: string | null;
  student: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  one_time_use: number;
  can_use_multiple_times: number;
  discount_type: "Fixed" | "Percentage";
  discount: number;
  maximum_discount_amount: number;
  creation: string | null;
  modified: string | null;
  owner: string | null;
  modified_by: string | null;
};

async function fetchAll(): Promise<Coupon[]> {
  const PAGE = 500;
  const fields = JSON.stringify([
    "name", "coupon_code", "is_active", "school", "student",
    "start_datetime", "end_datetime", "one_time_use", "can_use_multiple_times",
    "discount_type", "discount", "maximum_discount_amount",
    "creation", "modified", "owner", "modified_by",
  ]);
  const out: Coupon[] = [];
  for (let start = 0; ; start += PAGE) {
    const qs = new URLSearchParams({
      fields,
      limit_start: String(start),
      limit_page_length: String(PAGE),
    });
    const url = `${ERP}/api/resource/${encodeURIComponent("Website Cart Coupon")}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `token ${TOKEN}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching Website Cart Coupon`);
    const rows = (await res.json()).data as Coupon[];
    out.push(...rows);
    process.stdout.write(`\r  fetched ${out.length}`);
    if (rows.length < PAGE) break;
  }
  process.stdout.write("\n");
  return out;
}

function toDate(s: string | null): Date | null {
  if (!s) return null;
  // ERPNext returns local datetime without TZ — treat as IST.
  const d = new Date(s.replace(" ", "T") + "+05:30");
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log(`▶ Pulling Website Cart Coupons from ${ERP}…`);
  const coupons = await fetchAll();
  console.log(`  ${coupons.length} rows`);

  console.log("▶ Building local lookup tables (schools/students by erp_name)…");
  const schoolMap = new Map<string, string>();
  for (const r of await sql<{ id: string; erp_name: string }[]>`
    SELECT id, erp_name FROM schools WHERE erp_name IS NOT NULL`) {
    schoolMap.set(r.erp_name, r.id);
  }
  const studentMap = new Map<string, string>();
  for (const r of await sql<{ id: string; erp_name: string }[]>`
    SELECT id, erp_name FROM students WHERE erp_name IS NOT NULL`) {
    studentMap.set(r.erp_name, r.id);
  }
  console.log(`  ${schoolMap.size} schools, ${studentMap.size} students indexed`);

  console.log("▶ Upserting…");
  let inserted = 0;
  let updated = 0;
  let unmatchedSchool = 0;
  let unmatchedStudent = 0;
  for (const c of coupons) {
    const schoolId = c.school ? (schoolMap.get(c.school) ?? null) : null;
    const studentId = c.student ? (studentMap.get(c.student) ?? null) : null;
    if (c.school && !schoolId) unmatchedSchool++;
    if (c.student && !studentId) unmatchedStudent++;

    const r = await sql<{ inserted: boolean }[]>`
      INSERT INTO website_cart_coupons (
        erp_name, coupon_code, is_active,
        school_erp_name, school_id, student_erp_name, student_id,
        start_datetime, end_datetime,
        one_time_use, can_use_multiple_times,
        discount_type, discount, maximum_discount_amount,
        erp_creation, erp_modified, erp_owner, erp_modified_by,
        updated_at
      ) VALUES (
        ${c.name}, ${c.coupon_code}, ${!!c.is_active},
        ${c.school}, ${schoolId}, ${c.student}, ${studentId},
        ${toDate(c.start_datetime)}, ${toDate(c.end_datetime)},
        ${!!c.one_time_use}, ${!!c.can_use_multiple_times},
        ${c.discount_type}, ${c.discount}, ${c.maximum_discount_amount ?? 0},
        ${toDate(c.creation)}, ${toDate(c.modified)}, ${c.owner}, ${c.modified_by},
        NOW()
      )
      ON CONFLICT (erp_name) WHERE erp_name IS NOT NULL DO UPDATE SET
        coupon_code = EXCLUDED.coupon_code,
        is_active = EXCLUDED.is_active,
        school_erp_name = EXCLUDED.school_erp_name,
        school_id = EXCLUDED.school_id,
        student_erp_name = EXCLUDED.student_erp_name,
        student_id = EXCLUDED.student_id,
        start_datetime = EXCLUDED.start_datetime,
        end_datetime = EXCLUDED.end_datetime,
        one_time_use = EXCLUDED.one_time_use,
        can_use_multiple_times = EXCLUDED.can_use_multiple_times,
        discount_type = EXCLUDED.discount_type,
        discount = EXCLUDED.discount,
        maximum_discount_amount = EXCLUDED.maximum_discount_amount,
        erp_creation = EXCLUDED.erp_creation,
        erp_modified = EXCLUDED.erp_modified,
        erp_owner = EXCLUDED.erp_owner,
        erp_modified_by = EXCLUDED.erp_modified_by,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted`;
    if (r[0]?.inserted) inserted++; else updated++;
  }
  console.log(`  ✓ inserted=${inserted} updated=${updated}`);
  console.log(`  ↪ unresolved school links: ${unmatchedSchool}`);
  console.log(`  ↪ unresolved student links: ${unmatchedStudent}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
