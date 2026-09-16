import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/products.
 *
 * Products were folded under the single `catalog` permission. They are their
 * own key now (`products.*`). `catalog` is still accepted during the rollout —
 * see db/migrations/0076_catalog_module_permissions.sql for why, and for the
 * contract step that removes it.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["products", "catalog"]}>{children}</SectionGate>;
}
