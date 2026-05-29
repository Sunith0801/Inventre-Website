import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db/client";
import {
  products,
  categories,
  productImages,
  productVariants,
  productSchool,
  productGrades,
  schools,
} from "@/db/schema";
import {
  PageHeader,
  Card,
  Toolbar,
  SearchInput,
  Button,
  EmptyState,
  FilterChips,
} from "@/components/admin/ui/primitives";
import { ExportButton } from "@/components/admin/ExportButton";
import { ArchiveErpDisabledButton } from "@/components/admin/ArchiveErpDisabledButton";
import { ProductsTableClient } from "@/components/admin/ProductsTableClient";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: null, label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

export default async function ProductsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; status?: string; schoolId?: string; erp?: string;
    grade?: string; kind?: string;
  }>;
}) {
  // Catalog management is super/ops only — school_admin can't write products,
  // so we don't show them the list either (avoids a dead-end UX).
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q, status, schoolId, erp, grade, kind } = await searchParams;
  const conds = [];
  if (q) {
    conds.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.slug, `%${q}%`),
        ilike(sql`COALESCE(${products.itemCode}, '')`, `%${q}%`)
      )!
    );
  }
  if (status) conds.push(eq(products.status, status as never));
  if (erp === "disabled") conds.push(eq(products.erpIsDisabled, true));
  if (erp === "enabled")  conds.push(eq(products.erpIsDisabled, false));

  // Type filter — default "main" shows only buyable catalog items (Magic
  // Box / Bookkit / uniform / accessory); books, consumables and sub-bundles
  // are BOM components, surfaced when you drill into a kit, not standalone.
  // `products.kind` is a DB column not in this schema file, so use raw SQL.
  const kindFilter = kind || "main";
  if (kindFilter === "main") {
    conds.push(sql`products.kind IN ('magic_box','kit','uniform','accessory')`);
  } else if (kindFilter !== "all") {
    conds.push(sql`products.kind = ${kindFilter}`);
  }

  // super/ops can filter by any school + uniform grade via the dropdowns.
  // Mirrors the catalog logic: a product shows when it's bound to the
  // selected school AND (when a grade is picked) mapped to that grade.
  const effectiveSchoolId = schoolId ?? null;
  const effectiveGrade = grade ?? null;

  let qb = db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      itemCode: products.itemCode,
      basePrice: products.basePrice,
      status: products.status,
      categoryId: products.categoryId,
      erpIsDisabled: products.erpIsDisabled,
      erpIsDeleted: products.erpIsDeleted,
    })
    .from(products)
    .$dynamic();
  if (effectiveSchoolId) {
    qb = qb.innerJoin(
      productSchool,
      and(
        eq(productSchool.productId, products.id),
        eq(productSchool.schoolId, effectiveSchoolId)
      )
    );
  }
  if (effectiveGrade) {
    qb = qb.innerJoin(
      productGrades,
      and(
        eq(productGrades.productId, products.id),
        eq(productGrades.grade, effectiveGrade)
      )
    );
  }
  const rows = await qb
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(products.name));

  // Hydrate side data
  const ids = rows.map((r) => r.id);
  const [cats, allSchools, allGradeRows, primaryImages, variantCounts] = await Promise.all([
    db.select().from(categories),
    db.select().from(schools).orderBy(asc(schools.name)),
    db.selectDistinct({ grade: productGrades.grade }).from(productGrades),
    ids.length
      ? db
          .select({
            productId: productImages.productId,
            url: productImages.url,
            isPrimary: productImages.isPrimary,
            sortOrder: productImages.sortOrder,
          })
          .from(productImages)
          .where(inArray(productImages.productId, ids))
      : Promise.resolve([] as { productId: string; url: string; isPrimary: boolean; sortOrder: number }[]),
    ids.length
      ? db
          .select({
            productId: productVariants.productId,
            n: sql<number>`COUNT(*)::int`,
          })
          .from(productVariants)
          .where(
            and(
              inArray(productVariants.productId, ids),
              eq(productVariants.isActive, true)
            )
          )
          .groupBy(productVariants.productId)
      : Promise.resolve([] as { productId: string; n: number }[]),
  ]);

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  // Uniform grades that actually have products mapped — sorted numerically.
  const gradeNumber = (s: string) => {
    const n = parseInt(s.match(/\d+/)?.[0] ?? "");
    return isNaN(n) ? 999 : n;
  };
  const allGrades = allGradeRows
    .map((g) => g.grade)
    .sort((a, b) => gradeNumber(a) - gradeNumber(b) || a.localeCompare(b));

  // Grade dropdown options. When a school is picked we show ONLY that
  // school's own grade names (its ERP "Grades Details"), e.g. "IK 1",
  // not the standard grades. `value` stays the underlying grade so the
  // product filter still works.
  let gradeOpts: { value: string; label: string }[];
  if (effectiveSchoolId) {
    const lblRes = (await db.execute(
      sql`SELECT grade, school_grade_name FROM school_grade_labels WHERE school_id = ${effectiveSchoolId}`
    )) as unknown as { grade: string; school_grade_name: string }[];
    const lblRows = (
      Array.isArray(lblRes) ? lblRes : ((lblRes as { rows?: unknown[] }).rows ?? [])
    ) as { grade: string; school_grade_name: string }[];
    gradeOpts = lblRows
      .map((r) => ({
        value: r.grade,
        label: `${r.school_grade_name} (${r.grade})`,
      }))
      .sort((a, b) => gradeNumber(a.value) - gradeNumber(b.value));
  } else {
    gradeOpts = allGrades.map((g) => ({ value: g, label: g }));
  }
  // DSE is a separate grade stream — kept in its own group.
  const standardGradeOpts = gradeOpts.filter((o) => !/dse/i.test(o.value));
  const dseGradeOpts = gradeOpts.filter((o) => /dse/i.test(o.value));
  const variantCount = new Map(variantCounts.map((v) => [v.productId, Number(v.n)]));
  // Pick the primary image (or the lowest sortOrder one) per product.
  const imageByProduct = new Map<string, string>();
  for (const im of primaryImages) {
    const existing = imageByProduct.get(im.productId);
    if (im.isPrimary) imageByProduct.set(im.productId, im.url);
    else if (!existing) imageByProduct.set(im.productId, im.url);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description={`${rows.length} product${rows.length === 1 ? "" : "s"}${
          effectiveSchoolId
            ? ` for ${
                allSchools.find((s) => s.id === effectiveSchoolId)?.name ??
                "selected school"
              }`
            : ""
        }${effectiveGrade ? ` · ${effectiveGrade}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <ExportButton type="products" />
            <Link href="/admin/products/new">
              <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
                Add product
              </Button>
            </Link>
          </div>
        }
      />

      <form method="GET">
        <Toolbar>
          <SearchInput
            defaultValue={q ?? ""}
            placeholder="Search by name, slug, or item code…"
          />
          {allSchools.length > 0 ? (
            <select
              name="schoolId"
              defaultValue={schoolId ?? ""}
              className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
            >
              <option value="">All schools</option>
              {allSchools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          {gradeOpts.length > 0 ? (
            <select
              name="grade"
              defaultValue={grade ?? ""}
              className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
              title={
                effectiveSchoolId
                  ? "Filter by the school's grade"
                  : "Pick a school to see its grade names"
              }
            >
              <option value="">All grades</option>
              {standardGradeOpts.length > 0 ? (
                <optgroup label={effectiveSchoolId ? "School grades" : "Grades"}>
                  {standardGradeOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {dseGradeOpts.length > 0 ? (
                <optgroup label="DSE grades">
                  {dseGradeOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : null}
          <FilterChips
            options={STATUS_OPTIONS}
            value={status ?? null}
            baseHref="/admin/products"
            paramName="status"
          />
          <select
            name="kind"
            defaultValue={kind ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
            title="Filter by item type"
          >
            <option value="">Main items</option>
            <option value="kit">Bookkits</option>
            <option value="magic_box">Magic Boxes</option>
            <option value="uniform">Uniforms</option>
            <option value="accessory">Accessories</option>
            <option value="book">Books</option>
            <option value="consumable">Consumables</option>
            <option value="sub_bundle">Sub-bundles</option>
            <option value="all">All types</option>
          </select>
          <select
            name="erp"
            defaultValue={erp ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
            title="Filter by ERP-disabled flag"
          >
            <option value="">ERP: any</option>
            <option value="enabled">ERP: enabled</option>
            <option value="disabled">ERP: disabled</option>
          </select>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <ArchiveErpDisabledButton />
        </Toolbar>
      </form>
      {/* Auto-apply: any dropdown change submits the GET filter form. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.addEventListener('change',function(e){var t=e.target;" +
            "if(t&&t.tagName==='SELECT'&&t.form&&(t.form.method||'').toLowerCase()==='get'){t.form.submit();}});",
        }}
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={q ? `No products match “${q}”` : "No products yet"}
            description="Create one with the button above, or import from CSV/ERP."
          />
        ) : (
          <ProductsTableClient
            rows={rows.map((p) => ({
              id: p.id,
              slug: p.slug,
              name: p.name,
              itemCode: p.itemCode,
              basePrice: p.basePrice,
              status: p.status as "draft" | "active" | "archived",
              categoryId: p.categoryId,
              erpIsDisabled: p.erpIsDisabled,
              erpIsDeleted: p.erpIsDeleted,
            }))}
            imageByProduct={Object.fromEntries(imageByProduct)}
            catName={Object.fromEntries(catName)}
            variantCount={Object.fromEntries(variantCount)}
          />
        )}
      </Card>
    </div>
  );
}
