import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/catalog/bundles.
 *
 * Bundles is its own permission (`catalog-bundles.*`); `catalog` is still accepted
 * during the rollout — see 0076_catalog_module_permissions.sql.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["catalog-bundles", "catalog"]}>{children}</SectionGate>;
}
