import { NextResponse } from "next/server";
import { requireParent, isResponse } from "@/server/parent-guard";
import { loadVariantBundleTree } from "@/server/repos/products";

/**
 * Returns a BOM tree for a template variant that has no product row of its own
 * (e.g. "SAS Suchitra Grade 7 BookkitHindi 2nd Lan Tel 3rd Lan" stored only as
 * a product_variants row on the parent bookkit product).
 *
 * GET /api/shop/bundle-for-variant?variantId=<uuid>&studentId=<uuid>
 */
export async function GET(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  const url = new URL(req.url);
  const variantId = url.searchParams.get("variantId");
  if (!variantId) {
    return NextResponse.json({ error: "variantId required" }, { status: 400 });
  }

  const requestedId = url.searchParams.get("studentId");
  const active =
    (requestedId && me.students.find((s) => s.id === requestedId)) ||
    me.students[0];
  const schoolId = active?.school?.id ?? null;

  const bundleTree = await loadVariantBundleTree(variantId, schoolId);
  return NextResponse.json({ bundleTree });
}
