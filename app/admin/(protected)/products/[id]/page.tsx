import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  ExternalLink as ExternalLinkIcon,
  AlertTriangle,
  IndianRupee,
} from "lucide-react";
import { ProductDeleteButton } from "@/components/admin/ProductDeleteButton";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import { db } from "@/db/client";
import { alias } from "drizzle-orm/pg-core";
import {
  products,
  categories,
  productImages,
  productGrades,
  productVariants,
  productVariantAttributes,
  productAttributes,
  productAttributeValues,
  itemPrices,
  productSchool,
  productBundles,
  bundleComponents,
  schools,
} from "@/db/schema";
import {
  PageHeader,
  Button,
  Badge,
  statusTone,
} from "@/components/admin/ui/primitives";
import {
  ProductBasicsForm,
  GradesPicker,
  ProductImages,
} from "@/components/admin/ProductEditTabs";
import { ProductContentEditor } from "@/components/admin/ProductContentEditor";
import { ProductVariantsEditor } from "@/components/admin/ProductVariantsEditor";
import { BomEditor } from "@/components/admin/BomEditor";
import { ProductLogisticsPanel } from "@/components/admin/ProductLogisticsPanel";

export const dynamic = "force-dynamic";

async function renderLogisticsPanel(productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!p) return null;
  const uomRows = (await db.execute(
    sql`SELECT id, uom, conversion_factor::text AS cf, is_default FROM product_uoms WHERE product_id = ${productId} ORDER BY is_default DESC, uom`
  )) as unknown as {
    id: string;
    uom: string;
    cf: string;
    is_default: boolean;
  }[];
  const barcodeRows = (await db.execute(
    sql`SELECT id, barcode, barcode_type, uom FROM product_barcodes WHERE product_id = ${productId} ORDER BY created_at`
  )) as unknown as {
    id: string;
    barcode: string;
    barcode_type: string | null;
    uom: string | null;
  }[];
  return (
    <ProductLogisticsPanel
      productId={productId}
      initial={{
        hsnCode: p.hsnCode ?? null,
        brand: p.brand ?? null,
        countryOfOrigin: p.countryOfOrigin ?? null,
        customsTariffNumber: p.customsTariffNumber ?? null,
        weightGrams: p.weightGrams ?? null,
        dimensions:
          (p.dimensions as { l?: number; w?: number; h?: number } | null) ?? null,
        minOrderQty: p.minOrderQty,
        reorderTatDays: p.reorderTatDays ?? null,
        uoms: uomRows.map((r) => ({
          id: r.id,
          uom: r.uom,
          conversionFactor: r.cf,
          isDefault: r.is_default,
        })),
        barcodes: barcodeRows.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          barcodeType: r.barcode_type,
          uom: r.uom,
        })),
      }}
    />
  );
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { id } = await params;
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!product) notFound();

  const [cats, images, grades, variants, schoolAssignments] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.path)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder)),
    db.select().from(productGrades).where(eq(productGrades.productId, id)),
    db
      .select()
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, id),
          eq(productVariants.isActive, true)
        )
      )
      .orderBy(asc(productVariants.size)),
    db
      .select({
        ps: productSchool,
        school: schools,
      })
      .from(productSchool)
      .innerJoin(schools, eq(schools.id, productSchool.schoolId))
      .where(eq(productSchool.productId, id)),
  ]);

  const variantCount = variants.length;

  // Variant decode (colour) + price + colour options — for the inline
  // variants editor shown for uniforms / non-bundle items.
  const vids = variants.map((v) => v.id);
  const colourRows = vids.length
    ? await db
        .select({
          variantId: productVariantAttributes.variantId,
          valueId: productVariantAttributes.valueId,
          attrId: productAttributes.id,
        })
        .from(productVariantAttributes)
        .innerJoin(
          productAttributes,
          eq(productAttributes.id, productVariantAttributes.attributeId)
        )
        .where(
          and(
            inArray(productVariantAttributes.variantId, vids),
            eq(productAttributes.type, "color")
          )
        )
    : [];
  const colourByVariant = new Map(colourRows.map((r) => [r.variantId, r.valueId]));
  const colourAttrIds = [...new Set(colourRows.map((r) => r.attrId))];
  const colourOptions = colourAttrIds.length
    ? await db
        .select({
          id: productAttributeValues.id,
          value: productAttributeValues.value,
          displayLabel: productAttributeValues.displayLabel,
        })
        .from(productAttributeValues)
        .where(inArray(productAttributeValues.attributeId, colourAttrIds))
        .orderBy(asc(productAttributeValues.value))
    : [];
  const priceRows = vids.length
    ? await db
        .select({ variantId: itemPrices.variantId, price: itemPrices.price })
        .from(itemPrices)
        .where(inArray(itemPrices.variantId, vids))
    : [];
  const priceByVariant = new Map<string, number>();
  for (const r of priceRows) {
    const cur = priceByVariant.get(r.variantId);
    if (cur === undefined || r.price < cur) priceByVariant.set(r.variantId, r.price);
  }

  // Real ERP uniform grades in use across the catalog — drives the
  // "Targeted grades" picker so it isn't a stale hard-coded list.
  const allGradeRows = await db
    .selectDistinct({ grade: productGrades.grade })
    .from(productGrades);
  const allGrades = allGradeRows
    .map((g) => g.grade)
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? ""),
        nb = parseInt(b.match(/\d+/)?.[0] ?? "");
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

  // BOM contents — what a kit / Magic Box bundles (from bundle_components).
  // We project `id` + `name`; itemCode is denormalised and missing on many
  // imported items + every product created via the guided wizard. The
  // editor identifies rows by productId (UUID) to stay correct in those
  // cases — see incident 2026-05-29 where wizard-created Bookkits showed
  // empty BOM rows because itemCode was null on the children.
  const bomComp = alias(products, "bom_comp");
  const bomRows = await db
    .select({
      qty: bundleComponents.qty,
      childId: bomComp.id,
      name: bomComp.name,
      itemCode: bomComp.itemCode,
    })
    .from(productBundles)
    .innerJoin(
      bundleComponents,
      eq(bundleComponents.bundleId, productBundles.id)
    )
    .innerJoin(bomComp, eq(bomComp.id, bundleComponents.productId))
    .where(eq(productBundles.productId, id))
    .orderBy(asc(bomComp.name));

  // Is this a kit / Magic Box (→ editable BOM) or a uniform (→ variants)?
  const kindRow = (
    (await db.execute(
      sql`SELECT kind FROM products WHERE id = ${id}`
    )) as unknown as { kind: string }[]
  );
  const productKind =
    (Array.isArray(kindRow) ? kindRow[0] : (kindRow as { rows?: { kind: string }[] }).rows?.[0])
      ?.kind ?? "";
  const isBomKind = ["kit", "magic_box", "sub_bundle"].includes(productKind);

  // Item list for the editable BOM's type-ahead.
  // Items selectable as BOM components. Includes products with NULL
  // itemCode (everything created via /admin/catalog/build, plus a
  // long tail of imported items) — the editor now keys rows by
  // productId rather than itemCode, so a missing code is fine.
  const bomItemList = isBomKind
    ? (
        await db
          .select({ id: products.id, code: products.itemCode, name: products.name })
          .from(products)
          .orderBy(asc(products.name))
      ).map((i) => ({ id: i.id, code: i.code, name: i.name }))
    : [];

  // Hoisted out of the JSX below to give Next.js's dev-mode source
  // attribution a single, stable element to point at — inlining the
  // ternary inside `<ProductBasicsForm afterBasics={…} />` produced a
  // recurring "missing key" overlay warning on this exact line even
  // though every list in either branch already had keys.
  const afterBasicsContent = isBomKind ? (
    <BomEditor
      productId={product.id}
      items={bomItemList}
      initial={bomRows.map((r) => ({
        productId: r.childId,
        label: r.itemCode ? `${r.name} (${r.itemCode})` : r.name,
        qty: Math.max(1, Math.round(Number(r.qty) || 1)),
      }))}
    />
  ) : (
    <ProductVariantsEditor
      productId={product.id}
      slug={product.slug}
      colourOptions={colourOptions.map((c) => ({
        id: c.id,
        label: c.displayLabel ? `${c.value} (${c.displayLabel})` : c.value,
      }))}
      initial={variants.map((v) => ({
        id: v.id,
        size: v.size,
        sku: v.sku,
        stockQty: v.stockQty,
        colorValueId: colourByVariant.get(v.id) ?? null,
        price: priceByVariant.get(v.id) ?? null,
      }))}
    />
  );

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/products" },
          { label: product.name },
        ]}
        title={product.name}
        description={
          <span className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[12px] text-ink-500">
              {product.slug}
            </span>
            <Badge tone={statusTone(product.status)} dot size="sm">
              {product.status}
            </Badge>
            <span className="text-[12px] text-ink-500">
              {variantCount} variant{variantCount === 1 ? "" : "s"} ·{" "}
              {images.length} image{images.length === 1 ? "" : "s"} ·{" "}
              {schoolAssignments.length} school
              {schoolAssignments.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <a
              href={`/shop/${product.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex"
            >
              <Button
                variant="ghost"
                size="sm"
                icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}
              >
                View in shop
              </Button>
            </a>
            <Link href={`/admin/products/${product.id}/schools`}>
              <Button
                variant="secondary"
                size="sm"
                icon={<Building2 className="h-3.5 w-3.5" />}
              >
                Schools
              </Button>
            </Link>
            {variantCount > 1 && (
              <Link href={`/admin/products/${product.id}/combo-prices`}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IndianRupee className="h-3.5 w-3.5" />}
                >
                  Combo prices
                </Button>
              </Link>
            )}
            <ProductDeleteButton
              productId={product.id}
              productName={product.name}
            />
          </div>
        }
      />

      {schoolAssignments.length === 0 ? (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-[13px]">
            <p className="font-semibold text-amber-900">
              This product is not visible to any school yet.
            </p>
            <p className="text-amber-800 mt-0.5">
              Storefront listings filter by school. Until you assign at least
              one school, parents won&apos;t see this product even if it&apos;s
              marked active.
            </p>
          </div>
          <Link href={`/admin/products/${product.id}/schools`}>
            <Button variant="primary" size="sm">
              Assign schools
            </Button>
          </Link>
        </div>
      ) : null}

      <div className="pp-layout">
        <div className="pp-main space-y-5">
          <ProductBasicsForm
            product={{
              id: product.id,
              slug: product.slug,
              name: product.name,
              tagline: product.tagline ?? "",
              basePrice: Math.round(product.basePrice / 100),
              baseMrp:
                product.baseMrp != null ? Math.round(product.baseMrp / 100) : null,
              categoryId: product.categoryId,
              status: product.status,
              itemCode: product.itemCode,
              hsnCode: product.hsnCode,
              gstTreatment: product.gstTreatment,
              gstInclusive: product.gstInclusive,
              brand: product.brand,
              displayPrice: product.displayPrice,
              costPrice: product.costPrice,
              organizationMrp: product.organizationMrp,
              customerDiscountPercent: product.customerDiscountPercent,
              weightGrams: product.weightGrams,
              minOrderQty: product.minOrderQty,
              isMagicBox: product.isMagicBox,
            }}
            categories={cats.map((c) => ({
              id: c.id,
              label: c.path,
              name: c.name,
            }))}
            afterBasics={afterBasicsContent}
          />

          <ProductContentEditor
            productId={product.id}
            initialDescription={
              (product.description as string[] | null) ?? null
            }
            initialSpecs={
              (product.specs as { label: string; value: string }[] | null) ??
              null
            }
            initialSizeTable={
              (product.sizeTable as
                | {
                    size: string;
                    chest: string;
                    length: string;
                    sleeve: string;
                  }[]
                | null) ?? null
            }
            initialSizeChartUrl={product.sizeChartUrl ?? null}
          />

          {/* Logistics, identifiers, UOMs, barcodes */}
          {await renderLogisticsPanel(product.id)}
        </div>

        <div className="pp-side space-y-5">
          <ProductImages
            productId={product.id}
            initial={images.map((i) => ({
              id: i.id,
              url: i.url,
              alt: i.alt,
              isPrimary: i.isPrimary,
              attributeValueId: i.attributeValueId,
            }))}
            colourOptions={colourOptions.map((c) => ({
              id: c.id,
              label: c.displayLabel ?? c.value,
            }))}
          />
          <GradesPicker
            productId={product.id}
            initial={grades.map((g) => g.grade)}
            allGrades={allGrades}
          />
        </div>
      </div>
    </div>
  );
}
