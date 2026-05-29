import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Resolve a product_variants row for (productId, …) at PDP time.
 *
 * Two call shapes (one win whichever matches first):
 *
 *  • Legacy single-axis: ?productId=&size=  — used by uniform PDPs whose
 *    shown sizes ("28", "2XL", "34-22") may carry a one- or two-letter
 *    ERPNext prefix in storage ("V28", "L2XL", "Q34-22"). We accept the
 *    exact value or the stored value with a leading 1–2 capital letters
 *    stripped.
 *
 *  • Multi-axis: ?productId=&attributes=<json>  — used by Item-Variant
 *    template PDPs (e.g. SMS Grade 11 Bookkit) whose variant is uniquely
 *    determined by the (attributeName → value) tuple. We require every
 *    axis in `attributes` to match a product_variant_attributes row for
 *    the same variant. Returns the variant only if exactly one matches.
 *
 * On the storefront the multi-axis case is also fast-path-resolved client
 * side via the DTO's `variantsByAttributeKey` map — this endpoint is the
 * server fallback for cases where the client only has the selection (e.g.
 * deep links, /api/cart consumers).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  const size = searchParams.get("size");
  const attributesRaw = searchParams.get("attributes");

  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  if (attributesRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(attributesRaw);
    } catch {
      return NextResponse.json(
        { error: "attributes must be a JSON object" },
        { status: 400 }
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "attributes must be a JSON object of {name: value}" },
        { status: 400 }
      );
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0
    );
    if (entries.length === 0) {
      return NextResponse.json({ variantId: null });
    }

    // Resolve to (attributeId, valueId) pairs first — the join is cleaner
    // than re-resolving name+value on every row.
    const idRows = (await db.execute(sql`
      SELECT pa.id AS attribute_id, av.id AS value_id
        FROM product_attributes pa
        JOIN product_attribute_values av ON av.attribute_id = pa.id
       WHERE (pa.name, av.value) IN (${sql.join(
         entries.map(([n, v]) => sql`(${n}, ${v})`),
         sql`, `
       )})
    `)) as unknown as { attribute_id: string; value_id: string }[];

    if (idRows.length !== entries.length) {
      // One of the (name, value) pairs doesn't exist in the attributes
      // catalog — no variant can possibly match.
      return NextResponse.json({ variantId: null });
    }

    // Variant must have every (attributeId, valueId) bound to it.
    const pairList = sql.join(
      idRows.map(
        (r) => sql`(${r.attribute_id}::uuid, ${r.value_id}::uuid)`
      ),
      sql`, `
    );
    const rows = (await db.execute(sql`
      SELECT pv.id
        FROM product_variants pv
       WHERE pv.product_id = ${productId}
         AND pv.is_active = true
         AND (
           SELECT count(*) FROM product_variant_attributes pva
            WHERE pva.variant_id = pv.id
              AND (pva.attribute_id, pva.value_id) IN (${pairList})
         ) = ${idRows.length}
       LIMIT 1
    `)) as unknown as { id: string }[];
    return NextResponse.json({ variantId: rows[0]?.id ?? null });
  }

  if (!size) {
    return NextResponse.json(
      { error: "size or attributes required" },
      { status: 400 }
    );
  }

  const rows = (await db.execute(sql`
    SELECT id FROM product_variants
     WHERE product_id = ${productId}
       AND is_active = true
       AND (
            size = ${size}
         OR regexp_replace(size, '^[A-Z]', '') = ${size}
         OR regexp_replace(size, '^[A-Z]{2}', '') = ${size}
       )
     LIMIT 1
  `)) as unknown as { id: string }[];
  return NextResponse.json({ variantId: rows[0]?.id ?? null });
}
