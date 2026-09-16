import { and, eq, asc, desc, inArray, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink as ExternalLinkIcon, CheckCircle2, AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { ProductDeleteButton } from "@/components/admin/ProductDeleteButton";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
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
import { PageHeader, Button, Badge, Card, CardHeader, Money, statusTone } from "@/components/admin/ui/primitives";
import { Tabs, resolveTab, type TabItem } from "@/components/admin/ui/tabs";
import { ProductBasicsForm, GradesPicker, ProductImages } from "@/components/admin/ProductEditTabs";
import { ProductContentEditor } from "@/components/admin/ProductContentEditor";
import { ProductVariantsEditor } from "@/components/admin/ProductVariantsEditor";
import { KitContentsEditor } from "@/components/admin/products/KitContentsEditor";
import { SectionBuilder, type SectionDef, type SectionItem } from "@/components/admin/products/SectionBuilder";
import { MAGIC_BOX_GROUPS } from "@/components/admin/products/product-kinds";
import { bundleSelectors } from "@/db/schema";
import { like } from "drizzle-orm";
import { ProductLogisticsPanel } from "@/components/admin/ProductLogisticsPanel";
import { RecordHistory } from "@/components/admin/RecordHistory";
import { SchoolsPicker } from "@/components/admin/products/SchoolsPicker";
import { PublishPanel } from "@/components/admin/products/PublishPanel";
import type { AttributeOption } from "@/components/admin/products/VariantGenerator";
import { getProductReadiness, type Step } from "@/server/admin/product-readiness";
import { applyScheduledPrices } from "@/server/admin/scheduled-prices";
import type { SizeChartRow } from "@/lib/size-chart";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  magic_box: "Magic Box", kit: "Book Kit", sub_bundle: "Sub-bundle", uniform: "Uniform",
  accessory: "Stationery / Item", book: "Book", consumable: "Consumable", excluded: "Excluded",
};

async function logisticsPanel(productId: string) {
  const [p] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!p) return null;
  const uomRows = (await db.execute(
    sql`SELECT id, uom, conversion_factor::text AS cf, is_default FROM product_uoms WHERE product_id = ${productId} ORDER BY is_default DESC, uom`,
  )) as unknown as { id: string; uom: string; cf: string; is_default: boolean }[];
  const barcodeRows = (await db.execute(
    sql`SELECT id, barcode, barcode_type, uom FROM product_barcodes WHERE product_id = ${productId} ORDER BY created_at`,
  )) as unknown as { id: string; barcode: string; barcode_type: string | null; uom: string | null }[];
  return (
    <ProductLogisticsPanel
      productId={productId}
      initial={{
        hsnCode: p.hsnCode ?? null,
        brand: p.brand ?? null,
        countryOfOrigin: p.countryOfOrigin ?? null,
        customsTariffNumber: p.customsTariffNumber ?? null,
        weightGrams: p.weightGrams ?? null,
        dimensions: (p.dimensions as { l?: number; w?: number; h?: number } | null) ?? null,
        minOrderQty: p.minOrderQty,
        reorderTatDays: p.reorderTatDays ?? null,
        uoms: uomRows.map((r) => ({ id: r.id, uom: r.uom, conversionFactor: r.cf, isDefault: r.is_default })),
        barcodes: barcodeRows.map((r) => ({ id: r.id, barcode: r.barcode, barcodeType: r.barcode_type, uom: r.uom })),
      }}
    />
  );
}

/**
 * The product record as a stepper. Every step is its own form with its
 * own Save, in the order an admin actually works: who and what → sizes
 * (or contents) → price → words → pictures → publish. The tab strip shows
 * which steps still block publishing, so "why isn't it on the website?"
 * is answered by the header, not by a support ticket.
 */
export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { id } = await params;
  const sp = await searchParams;
  // A scheduled price whose date has passed is promoted before the record
  // is read — so a stalled cron never shows a stale price in the admin.
  await applyScheduledPrices().catch(() => undefined);
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) notFound();

  const readiness = await getProductReadiness(id);
  if (!readiness) notFound();
  const isBundle = readiness.isBundle;

  // Uniform: Basic info → Variants → Pricing → Content → Kit contents
  // (optional, for sets) → Review. Book kit item: no variants, no
  // contents. Kits and boxes: Contents second, no variants.
  const singleItem = product.kind === "book" || product.kind === "consumable";
  // Book kits and Magic boxes are STAGED, not stepped: sections & items on
  // one screen, then price + image + status on one screen.
  const staged = product.kind === "kit" || product.kind === "magic_box";
  const STEPS: { key: Step; label: string }[] = staged
    ? [
        { key: "basics", label: "Basic info" },
        { key: "items", label: product.kind === "kit" ? "Sections & items" : "Sub-bundles & items" },
        { key: "publish", label: "Price & publish" },
      ]
    : [
        { key: "basics", label: "Basic info" },
        ...(isBundle ? [{ key: "bom" as Step, label: "Contents" }] : singleItem ? [] : [{ key: "variants" as Step, label: "Variants" }]),
        { key: "pricing", label: "Pricing" },
        { key: "content", label: "Content" },
        { key: "images", label: "Images" },
        ...(product.kind === "uniform" ? [{ key: "bom" as Step, label: "Kit contents" }] : []),
        { key: "publish", label: "Review & publish" },
      ];
  // On a staged product every non-basics failure lands on one of its two stages.
  const stepFor = (s: Step): Step => (staged ? (s === "basics" ? "basics" : s === "items" || s === "sections" || s === "bom" ? "items" : "publish") : s === "sections" ? "bom" : s);
  const failingSteps = new Set(readiness.failing.map((c) => stepFor(c.step)));
  const tabs: TabItem[] = STEPS.map((s, i) => ({
    key: s.key,
    label: `${i + 1}. ${s.label}`,
    icon:
      s.key === "publish"
        ? readiness.publishable
          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          : <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
        : failingSteps.has(s.key)
          ? <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          : undefined,
  }));
  const step = resolveTab(sp.step, tabs) as Step;
  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const hrefFor = (k: string) => `/admin/products/${id}?step=${k}`;

  // ── Data per step (only what the step needs) ────────────────────────
  const [cats, allSchools, schoolAssignments, grades, allGradeRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.path)),
    db.select({ id: schools.id, name: schools.name }).from(schools).orderBy(asc(schools.name)),
    db.select().from(productSchool).where(eq(productSchool.productId, id)),
    db.select().from(productGrades).where(eq(productGrades.productId, id)),
    db.selectDistinct({ grade: productGrades.grade }).from(productGrades),
  ]);
  const allGrades = allGradeRows.map((g) => g.grade).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] ?? ""), nb = parseInt(b.match(/\d+/)?.[0] ?? "");
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  let variantsStep: React.ReactNode = null;
  if (step === "variants" || step === "pricing") {
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(desc(productVariants.isActive), asc(productVariants.size));
    const vids = variants.map((v) => v.id);
    const stockRows = vids.length
      ? ((await db.execute(sql`SELECT variant_id, SUM(actual_qty - reserved_qty)::int AS qty FROM bins WHERE variant_id IN (${sql.join(vids.map((v) => sql`${v}::uuid`), sql`, `)}) GROUP BY variant_id`)) as unknown as { variant_id: string; qty: number }[])
      : [];
    const stockByVariant = Object.fromEntries((Array.isArray(stockRows) ? stockRows : ((stockRows as { rows?: { variant_id: string; qty: number }[] }).rows ?? [])).map((r) => [r.variant_id, r.qty]));
    const [colourRows, priceRows, attrRows, valueRows] = await Promise.all([
      vids.length
        ? db.select({ variantId: productVariantAttributes.variantId, valueId: productVariantAttributes.valueId })
            .from(productVariantAttributes)
            .innerJoin(productAttributes, eq(productAttributes.id, productVariantAttributes.attributeId))
            .where(and(inArray(productVariantAttributes.variantId, vids), eq(productAttributes.type, "color")))
        : Promise.resolve([]),
      vids.length ? db.select({ variantId: itemPrices.variantId, price: itemPrices.price }).from(itemPrices).where(inArray(itemPrices.variantId, vids)) : Promise.resolve([]),
      db.select({ id: productAttributes.id, name: productAttributes.name, type: productAttributes.type }).from(productAttributes).where(eq(productAttributes.isDisabled, false)).orderBy(asc(productAttributes.name)),
      db.select({ id: productAttributeValues.id, attributeId: productAttributeValues.attributeId, value: productAttributeValues.value, displayLabel: productAttributeValues.displayLabel })
        .from(productAttributeValues).where(eq(productAttributeValues.isActive, true)).orderBy(asc(productAttributeValues.sortOrder), asc(productAttributeValues.value)),
    ]);
    const colourByVariant = new Map(colourRows.map((r) => [r.variantId, r.valueId]));
    const priceByVariant = new Map<string, number>();
    for (const r of priceRows) { const cur = priceByVariant.get(r.variantId); if (cur === undefined || r.price < cur) priceByVariant.set(r.variantId, r.price); }
    const valuesByAttr = new Map<string, { id: string; label: string }[]>();
    for (const v of valueRows) valuesByAttr.set(v.attributeId, [...(valuesByAttr.get(v.attributeId) ?? []), { id: v.id, label: v.displayLabel ?? v.value }]);
    const attributeOptions: AttributeOption[] = attrRows.map((a) => ({ id: a.id, name: a.name, type: a.type, values: valuesByAttr.get(a.id) ?? [] }));
    const colourAttrs = attrRows.filter((a) => a.type === "color");
    const colourOptions = colourAttrs.flatMap((a) => (valuesByAttr.get(a.id) ?? []).map((v) => ({ id: v.id, label: colourAttrs.length > 1 ? `${v.label} (${a.name})` : v.label })));

    variantsStep = (
      <ProductVariantsEditor
        productId={product.id}
        slug={product.slug}
        colourOptions={colourOptions}
        attributeOptions={attributeOptions}
        stockByVariant={stockByVariant}
        initial={variants.map((v) => ({ id: v.id, size: v.size, sku: v.sku, stockQty: v.stockQty, colorValueId: colourByVariant.get(v.id) ?? null, price: priceByVariant.get(v.id) ?? null, isActive: v.isActive }))}
      />
    );
  }

  let bomStep: React.ReactNode = null;
  if (step === "bom") {
    const bomComp = alias(products, "bom_comp");
    const bomRows = await db
      .select({ qty: bundleComponents.qty, childId: bomComp.id, name: bomComp.name, itemCode: bomComp.itemCode })
      .from(productBundles)
      .innerJoin(bundleComponents, eq(bundleComponents.bundleId, productBundles.id))
      .innerJoin(bomComp, eq(bomComp.id, bundleComponents.productId))
      .where(eq(productBundles.productId, id))
      .orderBy(asc(bomComp.name));
    const lines = bomRows.map((r) => ({ productId: r.childId, name: r.name, itemCode: r.itemCode, qty: Math.max(1, Math.round(Number(r.qty) || 1)) }));
    bomStep = isBundle ? (
      <KitContentsEditor productId={product.id} initial={lines} optional={false} title="Contents" description="What ships in this kit. Search an item and add it; set how many." emptyTitle="Nothing in this kit yet" />
    ) : (
      <KitContentsEditor productId={product.id} initial={lines} optional title="Kit contents (optional)" description="Only for a uniform SET sold as one product — shirt + trousers + belt + tie. A single garment has nothing here." emptyTitle="Not a set" />
    );
  }

  // ── Sections & items (kits, boxes) ──────────────────────────────────
  let itemsStep: React.ReactNode = null;
  let partsTotal = 0;
  if (staged && (step === "items" || step === "publish")) {
    const [bundle] = await db.select({ id: productBundles.id }).from(productBundles).where(eq(productBundles.productId, id)).limit(1);
    if (bundle) {
      const compProduct = alias(products, "comp_product");
      const [selectors, comps, sectionCats] = await Promise.all([
        db.select().from(bundleSelectors).where(eq(bundleSelectors.bundleId, bundle.id)).orderBy(asc(bundleSelectors.sortOrder)),
        db
          .select({
            groupKey: bundleComponents.selectorGroupKey,
            productId: compProduct.id,
            name: compProduct.name,
            itemCode: compProduct.itemCode,
            basePrice: compProduct.basePrice,
            qty: bundleComponents.qty,
            sku: sql<string | null>`(SELECT v.sku FROM product_variants v WHERE v.product_id = ${compProduct.id} ORDER BY v.is_active DESC, v.size LIMIT 1)`,
            stock: sql<number | null>`(SELECT SUM(b.actual_qty - b.reserved_qty)::int FROM bins b JOIN product_variants v ON v.id = b.variant_id WHERE v.product_id = ${compProduct.id})`,
          })
          .from(bundleComponents)
          .innerJoin(compProduct, eq(compProduct.id, bundleComponents.productId))
          .where(eq(bundleComponents.bundleId, bundle.id))
          .orderBy(asc(compProduct.name)),
        product.kind === "kit"
          ? db.select({ id: categories.id, slug: categories.slug, name: categories.name }).from(categories).where(like(categories.path, "book-kit.%")).orderBy(asc(categories.sortOrder))
          : Promise.resolve([] as { id: string; slug: string; name: string }[]),
      ]);
      partsTotal = comps.reduce((a, c) => a + c.basePrice * c.qty, 0);
      const master: SectionDef[] =
        product.kind === "kit"
          ? sectionCats.map((c) => ({ groupKey: c.slug.replace(/^book-kit-/, ""), name: c.name, categoryId: c.id, kinds: ["book", "consumable", "accessory"] }))
          : MAGIC_BOX_GROUPS.map((g) => ({ groupKey: g.groupKey, name: g.name, kinds: [...g.kinds], onlyPublished: "onlyPublished" in g ? g.onlyPublished : false, hint: g.hint }));
      const initialItems: Record<string, SectionItem[]> = {};
      let legacy = 0;
      for (const c of comps) {
        if (!c.groupKey) { legacy++; continue; }
        (initialItems[c.groupKey] ??= []).push({ productId: c.productId, name: c.name, itemCode: c.itemCode, sku: c.sku, basePrice: c.basePrice, qty: c.qty, stock: c.stock });
      }
      itemsStep = (
        <>
          {legacy ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
              {legacy} item{legacy === 1 ? "" : "s"} from the older builder {legacy === 1 ? "is" : "are"} in this kit without a section. They still ship and still count toward the price; add them to a section here to show them grouped on the shop.
            </div>
          ) : null}
          <SectionBuilder
            bundleId={bundle.id}
            master={master}
            initialSections={selectors.map((s) => ({ groupKey: s.groupKey, name: s.name }))}
            initialItems={initialItems}
            chooseTitle={product.kind === "kit" ? "Which sections does this kit contain?" : "Which sub-bundles does this box contain?"}
            chooseHint={product.kind === "kit" ? "Tick from the master list, save, then fill each section on the right." : "Tick the ones that apply, save, then fill each one on the right."}
          />
        </>
      );
    } else {
      itemsStep = <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">This product has no bundle record — it was not created as a kit.</div>;
    }
  }

  let imagesStep: React.ReactNode = null;
  if (step === "images" || (staged && step === "publish")) {
    const [images, colourValues, variantRows] = await Promise.all([
      db.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.sortOrder)),
      db.select({ id: productAttributeValues.id, value: productAttributeValues.value, displayLabel: productAttributeValues.displayLabel })
        .from(productAttributeValues).innerJoin(productAttributes, eq(productAttributes.id, productAttributeValues.attributeId))
        .where(and(eq(productAttributes.type, "color"), eq(productAttributeValues.isActive, true))).orderBy(asc(productAttributeValues.value)),
      db.select({ id: productVariants.id, size: productVariants.size, sku: productVariants.sku }).from(productVariants).where(and(eq(productVariants.productId, id), eq(productVariants.isActive, true))).orderBy(asc(productVariants.size)),
    ]);
    imagesStep = (
      <ProductImages
        productId={product.id}
        initial={images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, isPrimary: i.isPrimary, attributeValueId: i.attributeValueId, variantId: i.variantId }))}
        colourOptions={colourValues.map((c) => ({ id: c.id, label: c.displayLabel ?? c.value }))}
        variantOptions={variantRows.map((v) => ({ id: v.id, label: v.sku && v.sku !== v.size ? `${v.size} (${v.sku})` : v.size }))}
      />
    );
  }

  const basicsFields = {
    id: product.id, slug: product.slug, name: product.name, tagline: product.tagline ?? "",
    basePrice: Math.round(product.basePrice / 100), baseMrp: product.baseMrp != null ? Math.round(product.baseMrp / 100) : null,
    categoryId: product.categoryId, status: product.status, itemCode: product.itemCode, hsnCode: product.hsnCode,
    gstTreatment: product.gstTreatment, gstInclusive: product.gstInclusive, brand: product.brand, displayPrice: product.displayPrice,
    costPrice: product.costPrice, organizationMrp: product.organizationMrp, customerDiscountPercent: product.customerDiscountPercent,
    weightGrams: product.weightGrams, minOrderQty: product.minOrderQty, isMagicBox: product.isMagicBox,
    gstRate: product.gstRate != null ? Number(product.gstRate) : null,
    priceEffectiveFrom: product.priceEffectiveFrom ?? null,
    scheduledBasePrice: product.scheduledBasePrice != null ? Math.round(product.scheduledBasePrice / 100) : null,
  };
  const catOptions = cats.map((c) => ({ id: c.id, label: c.path, name: c.name }));

  return (
    <div>
      <PageHeader
        eyebrow="Products"
        breadcrumb={[{ label: "Products", href: "/admin/products" }, { label: product.name }]}
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(product.status)} dot size="sm">{product.status === "active" ? "Published" : product.status === "archived" ? "Hidden" : "Draft"}</Badge>
            <Badge tone="subtle" size="sm">{KIND_LABEL[product.kind] ?? product.kind}</Badge>
            {product.itemCode ? <span className="font-mono text-[12px] text-ink-400">{product.itemCode}</span> : null}
            {!readiness.publishable ? (
              <Link href={hrefFor("publish")} className="text-[12px] font-medium text-amber-800 hover:underline">
                {readiness.failing.length} thing{readiness.failing.length === 1 ? "" : "s"} before it can publish
              </Link>
            ) : null}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <a href={`/shop/${product.slug}`} target="_blank" rel="noreferrer" className="inline-flex">
              <Button variant="ghost" size="sm" icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}>View in shop</Button>
            </a>
            <ProductDeleteButton productId={product.id} productName={product.name} />
          </div>
        }
      />

      <Tabs tabs={tabs} active={step} hrefFor={hrefFor} className="mb-5" />

      {step === "basics" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <ProductBasicsForm product={basicsFields} categories={catOptions} section="basics" />
            {await logisticsPanel(product.id)}
          </div>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Schools" description="Who sells this. Parents see only their own school's products." />
              <SchoolsPicker
                productId={product.id}
                schools={allSchools}
                initial={schoolAssignments.map((a) => ({
                  schoolId: a.schoolId,
                  overridePrice: a.overridePrice != null ? Math.round(a.overridePrice / 100) : null,
                  overrideMrp: a.overrideMrp != null ? Math.round(a.overrideMrp / 100) : null,
                  isRequired: a.isRequired,
                  customImageUrl: a.customImageUrl ?? null,
                }))}
              />
            </Card>
            <GradesPicker productId={product.id} initial={grades.map((g) => g.grade)} allGrades={allGrades} />
          </div>
        </div>
      ) : null}

      {step === "variants" ? variantsStep : null}
      {step === "bom" ? bomStep : null}
      {step === "items" ? itemsStep : null}

      {step === "pricing" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ProductBasicsForm product={basicsFields} categories={catOptions} section="pricing" />
          </div>
          <div className="space-y-5">
            {!isBundle && !singleItem ? (
              <Card>
                <CardHeader title="Per-size prices" description="When every size has its own price." />
                <p className="text-[13px] text-ink-600">Set them in the price column on the <Link href={hrefFor("variants")} className="font-semibold text-brand-700 hover:text-brand-800">Variants</Link> step. A size without one sells at the base price.</p>
              </Card>
            ) : null}
            <Card>
              <CardHeader title="Per-school prices" description="When a school pays a different amount." />
              <p className="text-[13px] text-ink-600">{schoolAssignments.filter((a) => a.overridePrice != null).length} of {schoolAssignments.length} schools have their own price.</p>
              <Link href={`/admin/products/${product.id}/schools`} className="mt-3 inline-block"><Button variant="secondary" size="sm">Open school pricing</Button></Link>
            </Card>
          </div>
        </div>
      ) : null}

      {step === "content" ? (
        <ProductContentEditor
          productId={product.id}
          initialDescription={(product.description as string[] | null) ?? null}
          initialSpecs={(product.specs as { label: string; value: string }[] | null) ?? null}
          initialSizeTable={(product.sizeTable as SizeChartRow[] | null) ?? null}
          initialSizeChartUrl={product.sizeChartUrl ?? null}
          initialImageNote={product.imageNote ?? null}
        />
      ) : null}

      {step === "images" ? <div className="max-w-3xl">{imagesStep}</div> : null}

      {step === "publish" && staged ? (
        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <Card>
              <CardHeader title={product.kind === "kit" ? "Kit price" : "Bundle price"} description="What the parent pays for the whole thing, against buying every item separately." />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                <div><dt className="text-ink-500">Bought separately</dt><dd className="font-semibold text-ink-900"><Money paise={partsTotal} /></dd></div>
                <div><dt className="text-ink-500">{product.kind === "kit" ? "Kit price" : "Bundle price"}</dt><dd className="font-semibold text-ink-900"><Money paise={product.basePrice} /></dd></div>
                <div><dt className="text-ink-500">Parent saves</dt><dd className={product.basePrice > 0 && partsTotal > product.basePrice ? "font-semibold text-emerald-700" : "text-ink-400"}>{product.basePrice > 0 && partsTotal > product.basePrice ? <><Money paise={partsTotal - product.basePrice} /> ({Math.round(((partsTotal - product.basePrice) / partsTotal) * 100)}%)</> : "—"}</dd></div>
                <div><dt className="text-ink-500">GST rate</dt><dd className="text-ink-900">{product.gstRate != null ? `${Number(product.gstRate)}%` : <span className="text-ink-400">not set</span>}</dd></div>
              </dl>
              {product.basePrice > 0 && partsTotal > 0 && product.basePrice > partsTotal ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">The bundle costs more than its parts — parents would pay less buying separately.</p>
              ) : null}
            </Card>
            <ProductBasicsForm product={basicsFields} categories={catOptions} section="pricing" />
          </div>
          <div>{imagesStep}</div>
        </div>
      ) : null}
      {step === "publish" ? (
        <PublishPanel
          productId={product.id}
          status={product.status}
          checks={readiness.checks}
          publishable={readiness.publishable}
          shopHref={`/shop/${product.slug}`}
          stepMap={Object.fromEntries((["basics", "variants", "bom", "sections", "items", "pricing", "content", "images", "publish"] as Step[]).map((s) => [s, stepFor(s)]))}
        />
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-ink-100/70 pt-4">
        {stepIdx > 0 ? (
          <Link href={hrefFor(STEPS[stepIdx - 1]!.key)}><Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>{STEPS[stepIdx - 1]!.label}</Button></Link>
        ) : <span />}
        {stepIdx < STEPS.length - 1 ? (
          <Link href={hrefFor(STEPS[stepIdx + 1]!.key)}><Button variant="secondary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>Next: {STEPS[stepIdx + 1]!.label}</Button></Link>
        ) : null}
      </div>

      <div className="mt-5">
        <RecordHistory entityType="product" entityId={id} title="Product history" />
      </div>
    </div>
  );
}
