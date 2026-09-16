import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { productBundles, bundleComponents, bundleSelectors, products, productVariants } from "@/db/schema";
import { eq, asc, inArray, sql } from "drizzle-orm";
import { ArrowUpRight, Layers, ChevronRight, Package } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import { PageHeader, Card, CardHeader, Badge, Money, Button, type Tone } from "@/components/admin/ui/primitives";
import { BundleEditor, type ComponentRow } from "@/components/admin/BundleEditor";
import { DeleteBundleButton } from "@/components/admin/bundles/DeleteBundleButton";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

const KIND: Record<string, { label: string; tone: Tone }> = {
  magic_box: { label: "Magic Box", tone: "brand" },
  kit: { label: "Kit", tone: "info" },
  sub_bundle: { label: "Sub-bundle", tone: "violet" },
  book: { label: "Book", tone: "subtle" },
};

export default async function BundleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission("catalog-bundles.read", "catalog-bundles.write", "catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = canWritePage(guard.permissions, "catalog-bundles") || canWritePage(guard.permissions, "catalog");

  const { id } = await params;

  const [row] = await db
    .select({ bundle: productBundles, product: products })
    .from(productBundles)
    .innerJoin(products, eq(products.id, productBundles.productId))
    .where(eq(productBundles.id, id))
    .limit(1);
  if (!row) notFound();

  const [comps, sels, parents] = await Promise.all([
    db.select().from(bundleComponents).where(eq(bundleComponents.bundleId, id)),
    db.select().from(bundleSelectors).where(eq(bundleSelectors.bundleId, id)).orderBy(asc(bundleSelectors.sortOrder)),
    // Bundles whose component list includes this product (directly or via
    // one of its variants) — the way up the hierarchy.
    db
      .select({ bundleId: productBundles.id, name: products.name, kind: products.kind })
      .from(bundleComponents)
      .leftJoin(productVariants, eq(productVariants.id, bundleComponents.variantId))
      .innerJoin(productBundles, eq(productBundles.id, bundleComponents.bundleId))
      .innerJoin(products, eq(products.id, productBundles.productId))
      .where(sql`COALESCE(${bundleComponents.productId}, ${productVariants.productId}) = ${row.product.id}`)
      .orderBy(asc(products.name)),
  ]);

  // Resolve only the products the components reference (and their
  // variants) — not the whole catalogue. Rows bound to a variant resolve
  // their product through it.
  const compVariantIds = comps.map((c) => c.variantId).filter((x): x is string => !!x);
  const variantOwners = compVariantIds.length
    ? await db.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, compVariantIds))
    : [];
  const ownerByVariant = new Map(variantOwners.map((v) => [v.id, v.productId]));
  const productIds = [...new Set(comps.map((c) => c.productId ?? (c.variantId ? ownerByVariant.get(c.variantId) : null)).filter((x): x is string => !!x))];

  const [compProducts, compVariants, childBundles] = productIds.length
    ? await Promise.all([
        db.select({ id: products.id, name: products.name, itemCode: products.itemCode, basePrice: products.basePrice, kind: products.kind }).from(products).where(inArray(products.id, productIds)),
        db.select({ id: productVariants.id, productId: productVariants.productId, size: productVariants.size, sku: productVariants.sku }).from(productVariants).where(inArray(productVariants.productId, productIds)).orderBy(asc(productVariants.size)),
        db.select({ id: productBundles.id, productId: productBundles.productId }).from(productBundles).where(inArray(productBundles.productId, productIds)),
      ])
    : [[], [], []];
  const productById = new Map(compProducts.map((p) => [p.id, p]));
  const variantsByProduct = new Map<string, { id: string; size: string; sku: string }[]>();
  for (const v of compVariants) variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), { id: v.id, size: v.size, sku: v.sku }]);
  const bundleByProduct = new Map(childBundles.map((b) => [b.productId, b.id]));

  const initialComponents: ComponentRow[] = comps.map((c) => {
    const pid = c.productId ?? (c.variantId ? ownerByVariant.get(c.variantId) ?? null : null);
    const p = pid ? productById.get(pid) : undefined;
    return {
      id: c.id,
      variantId: c.variantId,
      productId: pid,
      qty: c.qty,
      selectorGroupKey: c.selectorGroupKey,
      selectorOptionLabel: c.selectorOptionLabel,
      isOptional: c.isOptional,
      isVisible: c.isVisible,
      product: p ? { id: p.id, name: p.name, itemCode: p.itemCode, basePrice: p.basePrice, kind: p.kind, variants: variantsByProduct.get(p.id) ?? [] } : null,
      isBundle: pid ? bundleByProduct.has(pid) : false,
      bundleId: pid ? bundleByProduct.get(pid) ?? null : null,
    };
  });

  const km = KIND[row.product.kind] ?? { label: row.product.kind.replace("_", " "), tone: "default" as Tone };
  const sum = initialComponents.reduce((a, c) => a + (c.product ? c.product.basePrice * c.qty : 0), 0);
  const nested = initialComponents.filter((c) => c.isBundle).length;

  return (
    <div>
      <PageHeader
        eyebrow="Bundles"
        breadcrumb={[{ label: "Bundles", href: "/admin/catalog/bundles" }, { label: row.product.name }]}
        title={row.product.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={km.tone} size="sm">{km.label}</Badge>
            {row.product.bundleLevel ? <Badge tone="subtle" size="sm">{row.product.bundleLevel.replace("_", " ")}</Badge> : null}
            <Badge tone={row.bundle.bundleType === "configurable" ? "warning" : "default"} size="sm">
              {row.bundle.bundleType === "configurable" ? "Configurable" : "Fixed contents"}
            </Badge>
            {row.product.itemCode ? <span className="font-mono text-[12px] text-ink-400">{row.product.itemCode}</span> : null}
          </span>
        }
        actions={
          <>
            <Link href={`/admin/products/${row.product.id}`}>
              <Button variant="secondary" size="sm" icon={<ArrowUpRight className="h-3.5 w-3.5" />}>Open product</Button>
            </Link>
            {canWrite ? <DeleteBundleButton bundleId={row.bundle.id} name={row.product.name} parentCount={parents.length} /> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            <BundleEditor
              bundleId={row.bundle.id}
              ownProductId={row.product.id}
              bundleType={row.bundle.bundleType}
              pricingMode={row.bundle.pricingMode}
              fixedPrice={row.bundle.fixedPrice}
              readOnly={!canWrite}
              initialComponents={initialComponents}
              initialSelectors={sels.map((s) => ({
                id: s.id,
                groupKey: s.groupKey,
                name: s.name,
                selectorType: s.selectorType,
                isRequired: s.isRequired,
                minSelections: s.minSelections,
                maxSelections: s.maxSelections,
                sortOrder: s.sortOrder,
              }))}
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Pricing" description="Set when the bundle was created." />
            <dl className="space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-500">Mode</dt>
                <dd className="font-medium text-ink-900">{row.bundle.pricingMode === "fixed" ? "Fixed price" : "Sum of components"}</dd>
              </div>
              {row.bundle.pricingMode === "fixed" ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-500">Sells at</dt>
                  <dd><Money paise={row.bundle.fixedPrice} className="font-semibold text-ink-900" /></dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-500">Components add up to</dt>
                <dd><Money paise={sum} className={row.bundle.pricingMode === "fixed" ? "text-ink-700" : "font-semibold text-ink-900"} /></dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-500">Product base price</dt>
                <dd><Money paise={row.product.basePrice} className="text-ink-700" /></dd>
              </div>
            </dl>
            {row.bundle.pricingMode === "fixed" && row.bundle.fixedPrice != null && row.bundle.fixedPrice !== sum ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Fixed price differs from the parts by <Money paise={Math.abs(row.bundle.fixedPrice - sum)} /> — {row.bundle.fixedPrice < sum ? "a bundle discount" : "a premium over buying separately"}.
              </p>
            ) : null}
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5 pb-2">
              <CardHeader
                title="Part of"
                description={parents.length ? `${parents.length} parent bundle${parents.length === 1 ? "" : "s"} include this one.` : "Top level — nothing contains it."}
                className="mb-0"
              />
            </div>
            {parents.length ? (
              <ul className="divide-y divide-ink-100/70">
                {parents.slice(0, 8).map((p) => {
                  const pk = KIND[p.kind] ?? { label: p.kind, tone: "default" as Tone };
                  return (
                    <li key={p.bundleId}>
                      <Link href={`/admin/catalog/bundles/${p.bundleId}`} className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-cream-50">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cream-100 text-ink-500"><Layers className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800">{p.name}</span>
                        <Badge tone={pk.tone} size="sm">{pk.label}</Badge>
                        <ChevronRight className="h-3.5 w-3.5 text-ink-300 transition-colors group-hover:text-ink-600" />
                      </Link>
                    </li>
                  );
                })}
                {parents.length > 8 ? <li className="px-5 py-2.5 text-[12px] text-ink-500">and {parents.length - 8} more</li> : null}
              </ul>
            ) : null}
          </Card>

          {nested ? (
            <Card>
              <CardHeader title="Nesting" className="mb-2" />
              <p className="flex items-start gap-2.5 text-[12.5px] text-ink-600">
                <Package className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                <span>{nested} component{nested === 1 ? "" : "s"} {nested === 1 ? "is" : "are"} bundle{nested === 1 ? "" : "s"} in {nested === 1 ? "its" : "their"} own right. The storefront expands them; click one in the list to edit its contents.</span>
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <RecordHistory entityType="bundle" entityId={id} title="Bundle history" />
      </div>
    </div>
  );
}
