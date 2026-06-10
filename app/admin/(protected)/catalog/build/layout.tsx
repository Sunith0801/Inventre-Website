/**
 * Layout wrapper for every `/admin/catalog/build/*` route. The
 * `data-catalog-build` attribute is the hook our globals.css uses to
 * strip the browser-default spinner UI off every `<input type="number">`
 * in the wizards — admins type prices and qty fast and the spinners
 * caused accidental scroll-wheel increments.
 */
export default function CatalogBuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div data-catalog-build>{children}</div>;
}
