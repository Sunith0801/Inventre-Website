import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Package,
  Library,
  IndianRupee,
  ExternalLink,
  Pencil,
  Boxes,
  ChevronRight,
} from "lucide-react";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import {
  PageHeader,
  Card,
  Badge,
  SectionTitle,
} from "@/components/admin/ui/primitives";
import { getProductBySlug, type BundleNode } from "@/lib/repos/products";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ schoolId?: string; grade?: string; mode?: "new" | "ret" }>;

export default async function CatalogPreviewDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const guard = await requireAdmin("super", "ops", "school_admin");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { slug } = await params;
  const sp = await searchParams;
  const schoolId = sp.schoolId ?? undefined;

  const product = await getProductBySlug(slug, schoolId);
  if (!product) notFound();

  const backHref = `/admin/catalog?${new URLSearchParams(
    Object.fromEntries(
      Object.entries(sp).filter(([, v]) => typeof v === "string" && v.length > 0) as [string, string][]
    )
  ).toString()}`;

  const totalBomItems = countBomLeaves(product.bundleTree);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog · Shop Preview"
        title={product.name}
        description={
          <span className="text-ink-600">
            Admin view of the storefront product detail page. Same data the parent sees.
          </span>
        }
        breadcrumb={[
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Catalog", href: backHref },
          { label: product.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/products/${product.id}`}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit product
            </Link>
            <a
              href={`/shop/${product.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-cream-100"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Storefront
            </a>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* ─── Hero column: image + price + key facts ────────────────── */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="aspect-square bg-cream-50 relative">
              {product.img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.img}
                  alt={product.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-ink-300">
                  <Package className="h-12 w-12" />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-4 space-y-3">
              <div className="flex items-baseline gap-3">
                <div className="text-[22px] font-bold text-ink-900">
                  ₹{product.price.toLocaleString("en-IN")}
                </div>
                {product.mrp != null && product.mrp > product.price && (
                  <div className="text-[13px] text-ink-400 line-through">
                    ₹{product.mrp.toLocaleString("en-IN")}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {product.isMagicBox && <Badge tone="brand">Magic Box</Badge>}
                {product.isKit && !product.isMagicBox && <Badge tone="info">Kit</Badge>}
                {product.kind && (
                  <Badge tone="subtle">kind: {product.kind}</Badge>
                )}
                {product.required && <Badge tone="warning">Required</Badge>}
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px] pt-2 border-t border-ink-100">
                <dt className="text-ink-500">Slug</dt>
                <dd className="text-ink-900 font-mono text-[11.5px] break-all">{product.slug}</dd>
                <dt className="text-ink-500">Sizes</dt>
                <dd className="text-ink-900">{product.sizes.join(", ") || "—"}</dd>
                <dt className="text-ink-500">Variants</dt>
                <dd className="text-ink-900">{product.variants.length}</dd>
                <dt className="text-ink-500">In stock</dt>
                <dd className="text-ink-900">{product.inStock ? "Yes" : "No"}</dd>
              </dl>

              <div className="pt-2 border-t border-ink-100 grid grid-cols-2 gap-1.5">
                {(product.isMagicBox || product.isKit) && (
                  <Link
                    href={`/admin/boms?q=${encodeURIComponent(product.name)}`}
                    className="flex items-center gap-1.5 px-2 h-8 rounded-md text-[12px] text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                  >
                    <Library className="h-3.5 w-3.5" /> Edit BOM
                  </Link>
                )}
                <Link
                  href={`/admin/catalog/pricing?q=${encodeURIComponent(product.name)}`}
                  className="flex items-center gap-1.5 px-2 h-8 rounded-md text-[12px] text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                >
                  <IndianRupee className="h-3.5 w-3.5" /> Edit price
                </Link>
                <Link
                  href={`/admin/catalog/stock?q=${encodeURIComponent(product.name)}`}
                  className="flex items-center gap-1.5 px-2 h-8 rounded-md text-[12px] text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                >
                  <Boxes className="h-3.5 w-3.5" /> Adjust stock
                </Link>
                <Link
                  href={`/admin/products/${product.id}`}
                  className="flex items-center gap-1.5 px-2 h-8 rounded-md text-[12px] text-ink-700 hover:bg-cream-100 hover:text-ink-900"
                >
                  <Pencil className="h-3.5 w-3.5" /> Open editor
                </Link>
              </div>
            </div>
          </Card>
        </div>

        {/* ─── Right column: variants, BOM tree, language variants ──── */}
        <div className="space-y-5">
          {product.variants.length > 0 && (
            <Card>
              <div className="p-4">
                <SectionTitle>Variants ({product.variants.length})</SectionTitle>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="text-left text-ink-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Size</th>
                        <th className="py-2 pr-3 font-medium">SKU</th>
                        <th className="py-2 pr-3 font-medium text-right">Price (paise)</th>
                        <th className="py-2 pr-3 font-medium text-right">MRP (paise)</th>
                        <th className="py-2 pr-3 font-medium text-right">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {product.variants.map((v) => (
                        <tr key={v.id}>
                          <td className="py-2 pr-3 text-ink-900">{v.size}</td>
                          <td className="py-2 pr-3 font-mono text-[11.5px] text-ink-600">{v.sku}</td>
                          <td className="py-2 pr-3 text-right text-ink-900">
                            {v.pricePaise.toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 pr-3 text-right text-ink-600">
                            {v.mrpPaise != null ? v.mrpPaise.toLocaleString("en-IN") : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right text-ink-900">{v.stockQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          )}

          {product.bundleTree.length > 0 && (
            <Card>
              <div className="p-4">
                <SectionTitle>
                  BOM tree
                  <span className="ml-2 text-ink-500 text-[12px] font-normal">
                    ({product.bundleTree.length} top-level · {totalBomItems} leaves)
                  </span>
                </SectionTitle>
                <div className="mt-3 border border-ink-100 rounded-lg divide-y divide-ink-100">
                  {product.bundleTree.map((node) => (
                    <BomRow key={node.componentId} node={node} depth={0} />
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-ink-400">
                  School-aware: prices and images reflect the active school's overrides where set.
                </p>
              </div>
            </Card>
          )}

          {product.kitLanguageVariants.length > 0 && (
            <Card>
              <div className="p-4">
                <SectionTitle>Sibling language variants ({product.kitLanguageVariants.length})</SectionTitle>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {product.kitLanguageVariants.map((v) => (
                    <Link
                      key={v.id}
                      href={`/admin/catalog/preview/${v.slug}?schoolId=${schoolId ?? ""}`}
                      className="flex items-center gap-3 p-2 rounded-lg border border-ink-100 hover:border-ink-300 hover:bg-cream-50"
                    >
                      <div className="w-12 h-12 rounded-md bg-cream-50 overflow-hidden flex-shrink-0">
                        {v.img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.img} alt={v.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-ink-300">
                            <Package className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink-900 truncate">{v.name}</div>
                        <div className="text-[12px] text-ink-500">₹{v.price.toLocaleString("en-IN")}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-ink-400 flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Recursive BOM tree row ─────────────────────────────────────────────

function BomRow({ node, depth }: { node: BundleNode; depth: number }) {
  return (
    <>
      <div
        className="flex items-center gap-3 px-3 py-2 hover:bg-cream-50"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <div className="w-9 h-9 rounded-md bg-cream-50 overflow-hidden flex-shrink-0">
          {node.img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.img} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full grid place-items-center text-ink-300">
              <Package className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/catalog/preview/${node.slug}`}
            className="text-[13px] font-medium text-ink-900 truncate hover:underline block"
          >
            {node.name}
          </Link>
          <div className="text-[11px] text-ink-500 flex items-center gap-2 mt-0.5">
            <span>{node.bundleLevel}</span>
            <span>·</span>
            <span>qty {node.qty}</span>
            {node.isOptional && (
              <>
                <span>·</span>
                <Badge tone="subtle">optional</Badge>
              </>
            )}
            {node.selectorGroupKey && (
              <>
                <span>·</span>
                <span className="text-ink-400">group: {node.selectorGroupKey}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-[12.5px] text-ink-700 text-right flex-shrink-0">
          <div>₹{(node.pricePaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
          {node.mrpPaise != null && node.mrpPaise > node.pricePaise && (
            <div className="text-[11px] text-ink-400 line-through">
              ₹{(node.mrpPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          )}
        </div>
        <Link
          href={`/admin/products/${node.productId}`}
          className="text-[11.5px] text-ink-500 hover:text-ink-900 px-2 py-1 rounded-md hover:bg-cream-100"
          title="Open product editor"
        >
          edit
        </Link>
      </div>
      {node.children.length > 0 &&
        node.children.map((c) => <BomRow key={c.componentId} node={c} depth={depth + 1} />)}
    </>
  );
}

function countBomLeaves(nodes: BundleNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.children.length === 0) n += 1;
    else n += countBomLeaves(node.children);
  }
  return n;
}
