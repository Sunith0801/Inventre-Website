import { NextResponse } from "next/server";
import { getSiteAccess } from "@/lib/site-access";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { listProductsForStudent } from "@/lib/repos/products";
import { toTargetedGrade } from "@/lib/repos/grades";
import {
  isCatalogDisabledSchool,
  catalogDisabledMessage,
} from "@/lib/school-catalog-gate";

/**
 * Roots-only shop feed.
 *
 * Returns the top-level products tagged for the active student's (school,
 * grade) — every (leaf | sub_bundle | bookkit) tagged in product_school +
 * product_grades, MINUS the ones that appear as children inside another
 * tagged product's BOM. So when a school has a "Book Set Grade N" rollup
 * containing 18 textbook leaves, the parent sees the one rollup, not 19
 * duplicate-buyable rows. Magic Box rollups are excluded entirely.
 *
 * Magic Box rows show all genders — both Boys and Girls boxes appear for
 * new students regardless of the student's recorded gender.
 */
export async function GET(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;
  // Access is per family: ANY switched-off student on this account closes
  // the catalog for all of them. Enforced here as well as in the shop
  // layout because route handlers never run that layout — a direct fetch
  // would otherwise still be served a full catalog.
  if (me.closedStudents.length > 0) {
    const access = await getSiteAccess();
    return NextResponse.json(
      { closed: true, title: access.title, subtitle: access.subtitle },
      { status: 403 },
    );
  }
  if (me.students.length === 0) {
    return NextResponse.json({ error: "No student attached" }, { status: 400 });
  }

  const url = new URL(req.url);
  const requestedId = url.searchParams.get("studentId");

  const active =
    (requestedId && me.students.find((s) => s.id === requestedId)) ||
    me.students[0];

  // Offline-only schools (e.g. Young India Police School) get NO catalog at
  // all — no products to add. Checked before the grade resolution below so
  // these parents never see a "grade is missing" prompt either.
  if (isCatalogDisabledSchool(active.school)) {
    return NextResponse.json(
      { error: catalogDisabledMessage(active.school.name) },
      { status: 400 }
    );
  }

  // `students.grade` is the Targeted-Grade vocabulary (Nursery / LKG / UKG
  // / Grade 1..12), same as `product_grades.grade`. When it's missing,
  // translate from `class` (ERP-uniform value or school-local label) via
  // `toTargetedGrade` so the page still loads.
  let grade = active.grade ?? null;
  if (!grade) {
    const fallback = await toTargetedGrade(active.school.id, active.class);
    if (fallback) {
      console.warn("[shop/products] students.grade missing, falling back via class", {
        studentId: active.id,
        schoolId: active.school.id,
        class: active.class,
        resolved: fallback,
      });
      grade = fallback;
    } else {
      return NextResponse.json(
        {
          error:
            "Student grade is missing. Ask admin to set the student's grade.",
        },
        { status: 400 }
      );
    }
  }
  const products = await listProductsForStudent({
    schoolId: active.school.id,
    grade,
    isNewStudent: active.isNewStudent,
  });

  return NextResponse.json({
    products,
    gradeFilter: grade,
    isNewStudent: active.isNewStudent,
    activeStudent: {
      id: active.id,
      name: active.name,
      class: active.class,
      grade: active.grade,
      schoolGivenGrade: active.schoolGivenGrade,
      section: active.section,
      gender: active.gender,
      isNewStudent: active.isNewStudent,
      school: {
        id: active.school.id,
        name: active.school.name,
        slug: active.school.slug,
      },
    },
  });
}
