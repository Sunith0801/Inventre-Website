import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/catalog — the hub page and the preview.
 *
 * Passes on ANY catalog module, not just `catalog` itself: the hub is where
 * the module links live, so a person granted only Stock must be able to open
 * it. Each module beneath narrows to its own key in a nested layout.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["catalog", "products", "boms", "categories", "catalog-attributes", "catalog-bundles", "catalog-build", "catalog-pricing", "catalog-setup", "catalog-stock"]}>{children}</SectionGate>;
}
