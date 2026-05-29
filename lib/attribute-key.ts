/**
 * Stable encoding of a multi-axis attribute selection into a lookup key.
 *
 * The PDP holds the user's selection as `Record<attributeName, value>`;
 * the server's `getProductBySlug` DTO ships a `variantsByAttributeKey`
 * map keyed by the same encoding. Both sides import this function so
 * the keys can't drift.
 *
 * Encoding: JSON-stringify a `[name, value][]` array sorted lexicographically
 * by name. Examples:
 *   { "SMS Grade 11 Mandate": "SMS Grade 11 Mandate", "SMS Grade 11 Core Subject": "Commerce" }
 *   → '[["SMS Grade 11 Core Subject","Commerce"],["SMS Grade 11 Mandate","SMS Grade 11 Mandate"]]'
 *
 * Skips any axis whose value is empty/undefined, so a partial selection
 * produces a key that won't match a complete-variant key in the map —
 * that's the caller's signal that more axes need to be picked.
 */
export function buildAttributeKey(selection: Record<string, string | undefined | null>): string {
  const pairs = Object.entries(selection)
    .filter((pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].length > 0)
    .map(([name, value]): [string, string] => [name, value])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(pairs);
}
