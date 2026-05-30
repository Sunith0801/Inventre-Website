import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Eye, Library, Plus } from "lucide-react";
import { db } from "@/db/client";
import { schools, products, productSchool, productGrades, productImages } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import { PageHeader, Card, Badge } from "@/components/admin/ui/primitives";
import { BulkTagItemsTool, type TaggableProduct } from "@/components/admin/BulkTagItemsTool";

export const dynamic = "force-dynamic";

type Params = Promise<{ schoolId: string; grade: string }>;

export default async function AddItemsPage({ params }: { params: Params }) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { schoolId, grade: rawGrade } = await params;
  const grade = decodeURIComponent(rawGrade);

  const [school] = await db
    .select({ id: schools.id, name: schools.name, code: schools.schoolCode })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (!school) notFound();

  // ── Pull every shoppable, non-variant product with its first image and
  //    base price. We hydrate "is this already tagged to (school, grade)?"
  //    via two cheap lookup queries below, then pass the merged shape to
  //    the client tool.
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      basePrice: products.basePrice,
      baseMrp: products.baseMrp,
      kind: sql<string>`kind::text`.as("kind"),
      isVariantItem: products.isVariantItem,
      status: products.status,
    })
    .from(products)
    .where(eq(products.status, "active"))
    .orderBy(asc(products.name));

  const ids = productRows.filter((p) => !p.isVariantItem).map((p) => p.id);

  // Product → first image URL. Scoped to ids on this page only — without the
  // inArray filter this would hydrate every product_images row in the DB.
  const imageRows = ids.length
    ? await db
        .select({ productId: productImages.productId, url: productImages.url })
        .from(productImages)
        .where(inArray(productImages.productId, ids))
        .orderBy(asc(productImages.sortOrder))
    : [];
  const firstImg = new Map<string, string>();
  for (const r of imageRows) if (!firstImg.has(r.productId)) firstImg.set(r.productId, r.url);

  // Currently bound to this school (any grade) — exposes existing
  // isRequired / overridePrice / overrideMrp so the tool pre-fills those edits.
  const schoolBindings = ids.length
    ? await db
        .select({
          productId: productSchool.productId,
          isRequired: productSchool.isRequired,
          overridePrice: productSchool.overridePrice,
          overrideMrp: productSchool.overrideMrp,
        })
        .from(productSchool)
        .where(eq(productSchool.schoolId, schoolId))
    : [];
  const boundToSchool = new Map(schoolBindings.map((r) => [r.productId, r]));

  // Currently tagged at this exact grade AND bound to this specific school.
  // product_grades has no school_id column, so we intersect with
  // product_school to avoid showing "tagged" for products that live at the
  // same grade name on a different school.
  const gradeBindings = ids.length
    ? await db
        .select({ productId: productGrades.productId })
        .from(productGrades)
        .innerJoin(
          productSchool,
          eq(productSchool.productId, productGrades.productId)
        )
        .where(
          and(
            eq(productGrades.grade, grade),
            eq(productSchool.schoolId, schoolId),
            inArray(productGrades.productId, ids)
          )
        )
    : [];
  const atThisGrade = new Set(gradeBindings.map((r) => r.productId));

  const items: TaggableProduct[] = productRows
    .filter((p) => !p.isVariantItem)
    .map((p) => {
      const sb = boundToSchool.get(p.id);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        kind: p.kind,
        basePricePaise: p.basePrice,
        baseMrpPaise: p.baseMrp,
        img: firstImg.get(p.id) ?? null,
        boundToSchool: Boolean(sb),
        taggedAtThisGrade: atThisGrade.has(p.id),
        currentIsRequired: sb?.isRequired ?? false,
        currentOverridePricePaise: sb?.overridePrice ?? null,
        currentOverrideMrpPaise: sb?.overrideMrp ?? null,
      };
    });

  const taggedCount = items.filter((i) => i.boundToSchool && i.taggedAtThisGrade).length;
  const newMbHref = `/admin/boms/new?schoolId=${schoolId}&grade=${encodeURIComponent(grade)}`;
  // Default to mode=new so the operator sees Magic Boxes (the curated kit
  // freshly-onboarded parents pick first). The picker on /admin/catalog has
  // a toggle to switch to the returning-student view.
  const previewHref = `/admin/catalog?schoolId=${schoolId}&grade=${encodeURIComponent(grade)}&mode=new`;

  return (
    <div>
      <PageHeader
        eyebrow="Catalog · Setup"
        title={`Add items to ${school.name}`}
        description={
          <>
            Currently <span className="font-semibold text-ink-900">{taggedCount}</span> items tagged
            to <span className="font-semibold text-ink-900">{grade}</span> at this school. Pick
            untagged products to add them; toggle the filter to edit already-tagged rows.
          </>
        }
        breadcrumb={[
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Catalog", href: "/admin/catalog" },
          { label: "Setup", href: "/admin/catalog/setup" },
          { label: `${school.name} · ${grade}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={newMbHref}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-cream-100"
            >
              <Library className="h-3.5 w-3.5" /> Create Magic Box
            </Link>
            <Link
              href={previewHref}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-cream-100"
            >
              <Eye className="h-3.5 w-3.5" /> Preview as parent
            </Link>
            <Link
              href={`/admin/products/new?schoolId=${schoolId}&grade=${encodeURIComponent(grade)}`}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
            >
              <Plus className="h-3.5 w-3.5" /> New product
            </Link>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="p-3 lg:p-4 flex items-center justify-between gap-3">
          <div className="text-[12px] text-ink-600">
            <span className="font-semibold text-ink-900">Per-school overrides:</span> tagging a row
            with a price uses that price for parents at this school; leave blank to inherit the
            product's base price. <Badge tone="warning">Required</Badge> marks a must-buy item.
          </div>
        </div>
      </Card>

      <BulkTagItemsTool
        schoolId={schoolId}
        schoolName={school.name}
        grade={grade}
        items={items}
      />
    </div>
  );
}
