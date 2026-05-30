/**
 * Per-stream "mandate subjects" lookup for guided-streams Bookkits.
 *
 * The wizard creates a `sub_bundle` product named `<templatePrefix> <streamLabel>`
 * for each stream that has mandate items. This route returns the list of
 * child product names per stream so the PDP can render a read-only
 * "Mandate Subjects" chip row inside the MultiAttributePicker — the same
 * stream value the parent picks determines which chips appear.
 *
 * Response shape:
 *   { axisName: "Stream", subjectsByValue: { Science: ["Physics", ...], ... } }
 *
 * When the parent kit has no Stream axis or no stub sub-bundles exist,
 * returns `{ axisName: null, subjectsByValue: {} }` and the PDP renders
 * nothing extra (existing behaviour preserved).
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export async function GET(
  _req: Request,
  { params }: { params: { productId: string } },
) {
  const productId = params.productId;
  if (!productId) {
    return NextResponse.json({ axisName: null, subjectsByValue: {} });
  }

  const rows = (await db.execute(sql`
    SELECT name, attribute_groups
      FROM products
     WHERE id = ${productId}
     LIMIT 1
  `)) as unknown as {
    name: string;
    attribute_groups: { name: string; values: string[] }[] | null;
  }[];
  const parent = rows[0];
  if (!parent) {
    return NextResponse.json({ axisName: null, subjectsByValue: {} });
  }

  const streamAxis = (parent.attribute_groups ?? []).find(
    (g) => g.name.toLowerCase() === "stream",
  );
  if (!streamAxis || streamAxis.values.length === 0) {
    return NextResponse.json({ axisName: null, subjectsByValue: {} });
  }

  // Match the variant-contents convention: strip trailing kit/set suffix.
  const templatePrefix = parent.name
    .replace(/\s+(book ?kit|book ?set|bookkit|bookset|kit|set)\s*$/i, "")
    .trim();

  const subjectsByValue: Record<string, string[]> = {};

  for (const value of streamAxis.values) {
    const candidates = [
      value,
      templatePrefix ? `${templatePrefix} ${value}`.trim() : null,
    ].filter((c): c is string => !!c);

    let subjectNames: string[] = [];
    for (const candidate of candidates) {
      const children = (await db.execute(sql`
        SELECT child.name AS name
          FROM products stub
          JOIN product_bundles pb ON pb.product_id = stub.id
          JOIN bundle_components bc ON bc.bundle_id = pb.id
          JOIN products child ON child.id = bc.product_id
         WHERE stub.name = ${candidate}
           AND stub.kind = 'sub_bundle'
           AND stub.status = 'active'
         ORDER BY child.name
      `)) as unknown as { name: string }[];
      if (children.length > 0) {
        subjectNames = children.map((c) => c.name);
        break;
      }
    }
    if (subjectNames.length > 0) subjectsByValue[value] = subjectNames;
  }

  return NextResponse.json({
    axisName: Object.keys(subjectsByValue).length > 0 ? streamAxis.name : null,
    subjectsByValue,
  });
}
