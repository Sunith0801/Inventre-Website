import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { productBundles, products } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { Library, Plus } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  Button,
} from "@/components/admin/ui/primitives";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export default async function BundlesPage() {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      bundle: productBundles,
      product: products,
      selectorCount: sql<number>`(SELECT COUNT(*) FROM bundle_selectors WHERE bundle_id = ${productBundles.id})::int`,
      componentCount: sql<number>`(SELECT COUNT(*) FROM bundle_components WHERE bundle_id = ${productBundles.id})::int`,
    })
    .from(productBundles)
    .innerJoin(products, eq(products.id, productBundles.productId))
    .orderBy(desc(productBundles.createdAt));

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Bundles"
        description="Fixed bundles ship the same components every time. Configurable bundles let parents pick options (e.g. Books Bundle with grade × language × stream)."
        actions={
          <Link href="/admin/catalog/bundles/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New bundle
            </Button>
          </Link>
        }
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Library}
            title="No bundles yet"
            description="Convert any product into a bundle and add components or selectors."
            action={
              <Link href="/admin/catalog/bundles/new">
                <Button icon={<Plus className="h-3.5 w-3.5" />}>New bundle</Button>
              </Link>
            }
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Bundle product</Th>
                <Th>Type</Th>
                <Th>Pricing</Th>
                <Th right>Components</Th>
                <Th right>Selectors</Th>
                <Th right>Fixed price</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.bundle.id}>
                  <Td>
                    <Link
                      href={`/admin/catalog/bundles/${r.bundle.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 transition-colors"
                    >
                      {r.product.name}
                    </Link>
                    {r.product.itemCode ? (
                      <div className="text-[11px] font-mono text-ink-500 mt-0.5">
                        {r.product.itemCode}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge
                      tone={r.bundle.bundleType === "configurable" ? "violet" : "info"}
                      size="sm"
                    >
                      {r.bundle.bundleType}
                    </Badge>
                  </Td>
                  <Td muted className="capitalize">
                    {r.bundle.pricingMode === "sum" ? "Sum of components" : "Fixed price"}
                  </Td>
                  <Td right>{r.componentCount}</Td>
                  <Td right>{r.selectorCount}</Td>
                  <Td right>
                    {r.bundle.fixedPrice != null ? (
                      <Money paise={r.bundle.fixedPrice} className="font-semibold" />
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
