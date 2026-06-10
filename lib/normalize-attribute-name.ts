/**
 * Canonicalise a product-attribute name for de-duplication.
 *
 * The catalog model lets two distinct `product_attributes` rows share the
 * same logical axis under different surface labels — most often "Size" vs
 * "Sizes", or "Colour" vs "Color". When two such rows end up bound to the
 * same product's variants, the PDP picker code rendered each as its own
 * group, producing the doubled-Size symptom seen on inventre-dev for the
 * sport polo product.
 *
 * Anywhere we bucket attributes by identity (re-derivation of
 * `products.attribute_groups`, defensive dedupe on the PDP, duplicate-name
 * checks on attribute create/rename) we now key by this normalised form so
 * the merge happens at the data layer instead of the render layer.
 *
 * Intentionally framework-agnostic — no `server-only` and no DB imports so
 * both server route handlers and client components can call it.
 */
export function normalizeAttributeName(name: string): string {
  const n = name.trim().toLowerCase();
  // Common English plurals that occur on this catalog. Keep the list small
  // and explicit; a generic stemmer would over-merge (e.g. "lens" → "len").
  if (n === "sizes") return "size";
  if (n === "colors" || n === "colours" || n === "colour") return "color";
  if (n === "designs") return "design";
  if (n === "models") return "model";
  return n;
}

/**
 * Group attribute-group entries by normalised name and merge their values.
 *
 * Preserves order: the first occurrence of each normalised key wins both
 * its display name and its position in the output. Within a merged group,
 * the first-seen value order is preserved (subsequent duplicates dropped).
 *
 * Used as a defensive read-time pass on the PDP so a single bad row in
 * `products.attribute_groups` doesn't render twice. The primary fix lives
 * at the write site (re-derivation in product PATCH + refreshProductAttributeGroups).
 */
export function dedupeAttributeGroups(
  groups: Array<{ name: string; values: string[] }>,
): Array<{ name: string; values: string[] }> {
  const order: string[] = [];
  const merged = new Map<
    string,
    { displayName: string; values: string[]; seen: Set<string> }
  >();
  for (const g of groups) {
    const key = normalizeAttributeName(g.name);
    let entry = merged.get(key);
    if (!entry) {
      entry = { displayName: g.name, values: [], seen: new Set<string>() };
      merged.set(key, entry);
      order.push(key);
    }
    for (const v of g.values) {
      if (!entry.seen.has(v)) {
        entry.seen.add(v);
        entry.values.push(v);
      }
    }
  }
  return order.map((k) => {
    const e = merged.get(k)!;
    return { name: e.displayName, values: e.values };
  });
}
