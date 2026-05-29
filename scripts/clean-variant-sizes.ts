/**
 * Clean `product_variants.size` for ERP-imported variants.
 *
 * On first import we set `size = item_name` as a placeholder (e.g.
 * "Boys Pant22$$"). This script extracts the actual axis value by
 * stripping the parent template's name prefix and trailing legacy
 * separators like "$$", "$", "B", "C" suffix codes.
 *
 *   "Boys Pant22$$"  ->  template "Boys Pant"  ->  "22"
 *   "Shoes-30B"      ->  template "Shoes"      ->  "30B"  (keep the B)
 *
 * The feed does not expose ERPNext's per-variant attribute matrix
 * (we verified live), so axis recovery is heuristic — but the parent
 * name is always a strict prefix of the variant name in this dataset,
 * so the prefix strip is reliable.
 *
 * Idempotent — safe to re-run. Skips variants whose `size` already
 * doesn't start with the parent name (i.e. already cleaned).
 */
import "dotenv/config";
import { db, schema } from "@/db/client";
import { eq, isNotNull } from "drizzle-orm";

function cleanSuffix(raw: string): string {
  let s = raw.trim();
  // Common legacy separators ERPNext used to dedupe variant keys.
  s = s.replace(/^[-_\s]+/, "");
  s = s.replace(/\${1,3}$/, ""); // trailing $, $$, $$$
  s = s.trim();
  return s;
}

(async () => {
  // Pull all ERP-sourced variants with their parent's name.
  const variants = await db
    .select({
      vId: schema.productVariants.id,
      vName: schema.productVariants.erpName,
      vSize: schema.productVariants.size,
      parentName: schema.productVariants.variantOfErpName,
    })
    .from(schema.productVariants)
    .where(isNotNull(schema.productVariants.variantOfErpName));

  console.log(`Scanning ${variants.length} ERP variants...`);

  let updated = 0;
  let alreadyClean = 0;
  let prefixMismatch = 0;

  for (const v of variants) {
    if (!v.vName || !v.parentName) continue;
    // If `vSize` doesn't start with the parent's name, it's already been cleaned
    // (or was never the placeholder shape). Skip.
    if (!v.vSize.startsWith(v.parentName)) {
      // ALSO catch the case where the cleaning resulted in something short;
      // skip if the size string is already short (1-10 chars).
      if (v.vSize.length <= 10) {
        alreadyClean++;
        continue;
      }
      prefixMismatch++;
      continue;
    }
    const suffix = v.vName.slice(v.parentName.length);
    const cleaned = cleanSuffix(suffix) || v.vName;
    if (cleaned === v.vSize) {
      alreadyClean++;
      continue;
    }
    await db
      .update(schema.productVariants)
      .set({ size: cleaned })
      .where(eq(schema.productVariants.id, v.vId));
    updated++;
  }

  console.log(`Updated:   ${updated}`);
  console.log(`Unchanged: ${alreadyClean}`);
  console.log(`No prefix: ${prefixMismatch}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
