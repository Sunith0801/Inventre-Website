import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  Package,
  Library,
  IndianRupee,
  ExternalLink,
  Pencil,
  Wrench,
  Plus,
} from "lucide-react";
import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  PageHeader,
  Button,
  Card,
  Badge,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { unstable_cache } from "next/cache";
import { CatalogPreviewPicker } from "@/components/admin/CatalogPreviewPicker";
import { listProductsForStudent } from "@/server/repos/products";
import { compareGrades } from "@/lib/sort-grades";

export const dynamic = "force-dynamic";

// Wrap the heavy listProductsForStudent in a per-(school, grade, mode)
// in-memory cache with a 90s TTL. The query path involves a recursive
// CTE over the BOM graph + 4 hydration queries + variant resolution +
// category map lookup; cold it can run ~1.5-2s, warm ~250ms. Admins
// rapidly toggling the school/grade picker would otherwise pay the cold
// cost every time. 90s is short enough that catalog edits show up
// "soon" without the admin having to hard-refresh.
// Tagged so any admin mutation that touches a product / variant / grade /
// school link / price calls `revalidateTag("admin-catalog")` and the
// preview busts immediately instead of waiting 90s. The TTL stays in
// place as a backstop for missed invalidation paths.
const cachedListProductsForStudent = unstable_cache(
  (schoolId: string, grade: string, isNewStudent: boolean) =>
    listProductsForStudent({ schoolId, grade, isNewStudent }),
  ["admin-catalog-preview"],
  { revalidate: 90, tags: ["admin-catalog"] }
);

type SearchParams = Promise<{ schoolId?: string; grade?: string; mode?: "new" | "ret" }>;

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function CatalogPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;

  // ── Load schools for the picker.
  //    super/ops see every active school. A school_admin must only see their
  //    own school — without this scope they could read every school's name
  //    via the picker dropdown. Fails closed: a school_admin with no
  //    schoolId gets an empty list.
  const isSchoolAdmin = guard.role === "school_admin";
  const scopedSchoolId = isSchoolAdmin ? guard.schoolId : null;
  const schoolRows =
    isSchoolAdmin && !scopedSchoolId
      ? []
      : await db
          .select({ id: schools.id, name: schools.name, code: schools.schoolCode })
          .from(schools)
          .where(
            scopedSchoolId
              ? and(eq(schools.status, "active"), eq(schools.id, scopedSchoolId))
              : eq(schools.status, "active")
          )
          .orderBy(asc(schools.name));

  // ── Default school. For school_admin we force their own school regardless
  //    of ?schoolId= so a crafted URL can't pivot them onto someone else.
  const activeSchoolId = scopedSchoolId ?? sp.schoolId ?? schoolRows[0]?.id ?? "";

  // ── Per-school grades — distinct grades that have at least one tagged
  //    product at this school. We filter to the Targeted-Grade vocabulary
  //    (Nursery / LKG / UKG / Grade 1..12 + DSE) so the dropdown matches
  //    what students.grade actually holds. Legacy ERP-uniform tags
  //    ("Grade 13/14/15") stay in product_grades for back-compat but
  //    don't appear here — students no longer carry those values.
  // Targeted-Grade vocab: regular grades + their DSE counterparts
  // (DSE-only catalog so regular Grade-N students don't see DSE bookkits).
  const REGULAR_GRADES = [
    "Nursery", "LKG", "UKG",
    "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
    "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
  ];
  const DSE_GRADES = Array.from(
    { length: 12 },
    (_, i) => `Grade ${i + 1} DSE`
  ).concat(["Grade 12 DSE", "Grade 13 DSE"]);
  const TARGETED_VOCAB = new Set<string>([...REGULAR_GRADES, ...DSE_GRADES]);
  const allGradeRows = activeSchoolId
    ? rowsOf<{ grade: string }>(
        await db.execute(sql`
          SELECT DISTINCT pg.grade AS grade
            FROM product_grades pg
            JOIN product_school ps ON ps.product_id = pg.product_id
                                   AND ps.school_id = ${activeSchoolId}
        `)
      )
    : [];
  const gradeRows = allGradeRows.filter(
    (r) => TARGETED_VOCAB.has(r.grade) || /\bDSE\b/i.test(r.grade)
  );

  gradeRows.sort((a, b) => compareGrades(a.grade, b.grade));

  const grades = gradeRows.map((r) => ({ value: r.grade, label: r.grade }));

  // ── Default grade = first one, unless ?grade= overrides.
  const activeGrade = sp.grade ?? grades[0]?.value ?? "";
  const isNewStudent = sp.mode === "new";

  // ── Fetch the actual storefront list using the SAME repo function the
  //    parent-facing /api/shop/products uses. Zero divergence: what we
  //    render here is exactly what a parent at this (school, grade,
  //    new/returning) tuple sees.
  const products =
    activeSchoolId && activeGrade
      ? await cachedListProductsForStudent(
          activeSchoolId,
          activeGrade,
          isNewStudent
        )
      : [];

  const activeSchool = schoolRows.find((s) => s.id === activeSchoolId);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Shop Preview"
        description="The shop exactly as a parent at this school and grade sees it. Pick a school, a grade and the student type."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/catalog/setup">
              <Button variant="secondary" icon={<Wrench className="h-3.5 w-3.5" />}>School Setup</Button>
            </Link>
            <Link href="/admin/catalog/build">
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Create new item</Button>
            </Link>
          </div>
        }
      />

      <CatalogPreviewPicker
        schools={schoolRows.map((s) => ({
          id: s.id,
          name: s.name + (s.code ? ` · ${s.code}` : ""),
        }))}
        grades={grades}
        activeSchoolId={activeSchoolId}
        activeGrade={activeGrade}
        mode={isNewStudent ? "new" : "ret"}
      />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-ink-700">
          <span className="font-semibold text-ink-900">{products.length} item{products.length === 1 ? "" : "s"}</span>
          {activeSchool ? ` visible at ${activeSchool.name}` : ""}
          {activeGrade ? ` · ${activeGrade}` : ""}
          {" · "}
          {isNewStudent ? "New student" : "Returning student"}
        </p>
        <p className="text-[12px] text-ink-500">
          {isNewStudent ? "New students see only the Magic Boxes for this grade." : "Returning students see the full catalogue; items inside a kit are hidden."}
        </p>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nothing tagged for this (school, grade) yet"
          description={
            activeSchoolId && activeGrade
              ? "Use the guided wizard to add a new Bookkit / Uniform / Magic Box already tagged to this school + grade — or tag existing products from the Products page or BOM Master."
              : "Pick a school and a grade above to preview."
          }
          action={
            activeSchoolId && activeGrade ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/admin/catalog/build"><Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />}>Create new item</Button></Link>
                <Link href="/admin/products"><Button variant="secondary">Open Products</Button></Link>
              </div>
            ) : null
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((p) => (
            <Card key={p.id} className="overflow-hidden flex flex-col">
              <div className="aspect-square bg-cream-50 relative overflow-hidden">
                {p.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.img}
                    alt={p.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-ink-300">
                    <Package className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
                  {p.isMagicBox && <Badge tone="brand">Magic Box</Badge>}
                  {p.isKit && !p.isMagicBox && <Badge tone="info">Kit</Badge>}
                  {p.hasLangOptions && <Badge tone="violet">Lang options</Badge>}
                  {p.required && <Badge tone="warning">Required</Badge>}
                  {!p.inStock && <Badge tone="danger">Out of stock</Badge>}
                </div>
              </div>

              <div className="p-3.5 flex-1 flex flex-col">
                <Link
                  href={`/admin/catalog/preview/${p.slug}?schoolId=${activeSchoolId}&grade=${encodeURIComponent(activeGrade)}&mode=${isNewStudent ? "new" : "ret"}`}
                  className="text-[13.5px] font-semibold text-ink-900 line-clamp-2 hover:underline"
                >
                  {p.name}
                </Link>
                <div className="mt-1 text-[11px] text-ink-500">
                  {p.sizes.length > 0 ? `${p.sizes.length} size${p.sizes.length === 1 ? "" : "s"}` : "—"}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-[15px] font-bold text-ink-900">
                    ₹{p.price.toLocaleString("en-IN")}
                  </span>
                  {p.mrp != null && p.mrp > p.price && (
                    <span className="text-[12px] text-ink-400 line-through">
                      ₹{p.mrp.toLocaleString("en-IN")}
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-ink-100 grid grid-cols-2 gap-1.5 text-[11.5px]">
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                  >
                    <Pencil className="h-3 w-3" /> Product
                  </Link>
                  {(p.isMagicBox || p.isKit) && (
                    <Link
                      href={`/admin/boms?q=${encodeURIComponent(p.name)}`}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                    >
                      <Library className="h-3 w-3" /> BOM
                    </Link>
                  )}
                  <Link
                    href={`/admin/catalog/pricing?q=${encodeURIComponent(p.name)}`}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                  >
                    <IndianRupee className="h-3 w-3" /> Price
                  </Link>
                  <a
                    href={`/shop/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                  >
                    <ExternalLink className="h-3 w-3" /> Storefront
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
