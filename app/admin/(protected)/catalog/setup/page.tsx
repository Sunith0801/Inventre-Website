import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Plus, GraduationCap, Eye } from "lucide-react";
import { db } from "@/db/client";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import {
  PageHeader,
  Card,
  SectionTitle,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { SchoolHealthRow, type SchoolHealth } from "@/components/admin/SchoolHealthRow";
import { compareGrades } from "@/lib/sort-grades";

export const dynamic = "force-dynamic";

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function CatalogSetupPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  // ── Per-school summary: grades defined, products tagged, magic boxes ────
  //    All in one query so the page renders in one DB round-trip.
  const schoolRows = rowsOf<{
    school_id: string;
    school_name: string;
    school_code: string | null;
    grades_defined: number;
    products_tagged: number;
    magic_boxes: number;
    is_setup_complete: boolean;
    status: string;
  }>(
    await db.execute(sql`
      SELECT
        s.id          AS school_id,
        s.name        AS school_name,
        s.school_code AS school_code,
        s.is_setup_complete AS is_setup_complete,
        s.status::text     AS status,
        (SELECT COUNT(*) FROM school_grade_mappings sgm
          WHERE sgm.school_id = s.id) AS grades_defined,
        (SELECT COUNT(DISTINCT ps.product_id) FROM product_school ps
          WHERE ps.school_id = s.id) AS products_tagged,
        (SELECT COUNT(DISTINCT ps.product_id) FROM product_school ps
            JOIN products p ON p.id = ps.product_id
           WHERE ps.school_id = s.id AND p.kind = 'magic_box') AS magic_boxes
      FROM schools s
      WHERE s.status IN ('active', 'onboarding')
      ORDER BY (s.status = 'onboarding') DESC, s.name
    `)
  );

  // ── Per-(school, grade) breakdown for the expanded row. Pre-fetched
  //    so expanding is instant — no per-row API call.
  const breakdownRows = rowsOf<{
    school_id: string;
    grade: string;
    school_given: string | null;
    regular_items: number;
    magic_boxes: number;
  }>(
    await db.execute(sql`
      WITH defined_grades AS (
        SELECT school_id, grade, school_given_grade_name AS school_given
          FROM school_grade_mappings
         WHERE grade IS NOT NULL
      ),
      tagged AS (
        SELECT ps.school_id, pg.grade,
               COUNT(DISTINCT pg.product_id) FILTER (WHERE p.kind <> 'magic_box') AS regular_items,
               COUNT(DISTINCT pg.product_id) FILTER (WHERE p.kind  = 'magic_box') AS magic_boxes
          FROM product_school ps
          JOIN product_grades pg ON pg.product_id = ps.product_id
          JOIN products p        ON p.id = pg.product_id AND p.status = 'active'
         GROUP BY ps.school_id, pg.grade
      )
      SELECT d.school_id, d.grade, d.school_given,
             COALESCE(t.regular_items, 0) AS regular_items,
             COALESCE(t.magic_boxes, 0)   AS magic_boxes
        FROM defined_grades d
        LEFT JOIN tagged t
          ON t.school_id = d.school_id AND t.grade = d.grade
       ORDER BY d.school_id, d.grade
    `)
  );

  // Group breakdowns under their school_id for the client component.
  // Re-sort each group by natural grade order — Postgres ORDER BY is
  // lexicographic so "Grade 10" would land before "Grade 2".
  const byId: Record<string, SchoolHealth["grades"]> = {};
  for (const r of breakdownRows) {
    (byId[r.school_id] ||= []).push({
      grade: r.grade,
      schoolGiven: r.school_given,
      regularItems: Number(r.regular_items),
      magicBoxes: Number(r.magic_boxes),
    });
  }
  for (const sid of Object.keys(byId)) {
    byId[sid].sort((a, b) => compareGrades(a.grade, b.grade));
  }

  const schools: SchoolHealth[] = schoolRows.map((r) => ({
    id: r.school_id,
    name: r.school_name,
    code: r.school_code,
    gradesDefined: Number(r.grades_defined),
    productsTagged: Number(r.products_tagged),
    magicBoxes: Number(r.magic_boxes),
    isSetupComplete: Boolean(r.is_setup_complete),
    schoolStatus: r.status === "onboarding" ? "onboarding" : "active",
    grades: byId[r.school_id] ?? [],
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Setup"
        description={
          <>
            One screen for the full lifecycle of a school's catalog. See where each
            active school is in its setup, click a row to drill into per-grade gaps,
            and follow the action links to the right editor. To onboard a brand new
            school, use{" "}
            <Link href="/admin/catalog/setup/new" className="font-semibold text-brand-700 hover:underline">
              + Add new school
            </Link>.
          </>
        }
        breadcrumb={[
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Catalog", href: "/admin/catalog" },
          { label: "Setup" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/catalog"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-cream-100"
            >
              <Eye className="h-3.5 w-3.5" /> Catalog Preview
            </Link>
            <Link
              href="/admin/catalog/setup/new"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add new school
            </Link>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-ink-900 text-white text-[11px] font-bold">
          ①
        </span>
        <span className="text-[12px] font-semibold text-ink-700 uppercase tracking-[0.12em]">
          {schools.length} active school{schools.length === 1 ? "" : "s"} · click a row to drill in
        </span>
      </div>

      {schools.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No active schools yet"
          description="Click 'Add new school' above to onboard the first one."
          action={
            <Link
              href="/admin/catalog/setup/new"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add new school
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Column header */}
          <div className="grid grid-cols-[1fr_90px_90px_90px_140px] items-center gap-3 px-4 py-2.5 bg-cream-50 border-b border-ink-100 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
            <div>School</div>
            <div className="text-right">Grades</div>
            <div className="text-right">Items</div>
            <div className="text-right">Magic boxes</div>
            <div className="text-right">Status</div>
          </div>
          <div className="divide-y divide-ink-100">
            {schools.map((s) => (
              <SchoolHealthRow key={s.id} school={s} />
            ))}
          </div>
        </Card>
      )}

      <div className="mt-5">
        <SectionTitle>How to read this</SectionTitle>
        <div className="mt-2 text-[13px] text-ink-600 space-y-1.5">
          <p>
            <span className="font-semibold text-ink-900">Grades</span> = rows in{" "}
            <code className="text-[12px] text-ink-700 bg-cream-100 px-1 py-0.5 rounded">school_grade_mappings</code>{" "}
            (the grades this school officially serves).
          </p>
          <p>
            <span className="font-semibold text-ink-900">Items</span> = distinct products tagged to this
            school in <code className="text-[12px] text-ink-700 bg-cream-100 px-1 py-0.5 rounded">product_school</code>,
            counted regardless of grade.
          </p>
          <p>
            <span className="font-semibold text-ink-900">Magic boxes</span> = items above where{" "}
            <code className="text-[12px] text-ink-700 bg-cream-100 px-1 py-0.5 rounded">kind = magic_box</code>.
            Required for new students.
          </p>
        </div>
      </div>
    </div>
  );
}
