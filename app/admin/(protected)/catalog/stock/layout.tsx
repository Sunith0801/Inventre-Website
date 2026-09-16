import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/catalog/stock.
 *
 * Stock is its own permission (`catalog-stock.*`); `catalog` is still accepted
 * during the rollout — see 0076_catalog_module_permissions.sql.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["catalog-stock", "catalog"]}>{children}</SectionGate>;
}
