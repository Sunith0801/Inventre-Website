import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/catalog/build (the bookkit / uniform wizards),
 * plus the styling hook this layout has always carried.
 *
 * Build is its own permission (`catalog-build.*`); `catalog` is still
 * accepted during the rollout — see 0076_catalog_module_permissions.sql.
 *
 * The `data-catalog-build` attribute is what globals.css uses to strip the
 * browser-default spinner UI off every `<input type="number">` in the
 * wizards — admins type prices and qty fast and the spinners caused
 * accidental scroll-wheel increments.
 */
export default function CatalogBuildLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectionGate slugs={["catalog-build", "catalog"]}>
      <div data-catalog-build>{children}</div>
    </SectionGate>
  );
}
