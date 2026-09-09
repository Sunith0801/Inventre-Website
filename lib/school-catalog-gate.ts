/**
 * Schools whose parents must NOT see a storefront catalog.
 *
 * Some schools are served entirely offline — uniforms and books are issued at
 * the school and imported into Inventre as offline orders (see
 * `scripts/import-yips-offline-orders.ts`). Their parents still log in to see
 * those orders, but they must never be shown products to add.
 *
 * Matched on `schools.slug`, with a name check as a safety net in case the
 * school row is re-created under a different slug.
 */
const DISABLED_SLUGS = new Set(["yips-young-india-police-school"]);
const DISABLED_NAME_RE = /young\s*india\s*police\s*school/i;

export function isCatalogDisabledSchool(school: {
  slug?: string | null;
  name?: string | null;
}): boolean {
  if (school.slug && DISABLED_SLUGS.has(school.slug.toLowerCase())) return true;
  return !!school.name && DISABLED_NAME_RE.test(school.name);
}

export function catalogDisabledMessage(schoolName?: string | null): string {
  const who = schoolName?.trim() || "your school";
  return `Online ordering isn't available for ${who}. Uniforms and books are issued directly by the school — please contact the school office for anything you need.`;
}
