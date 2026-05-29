import { NextResponse } from "next/server";
import { getCurrentParent } from "@/lib/session";
import { getBundlePdpConfig } from "@/lib/bundle-engine";

/**
 * Public bundle PDP config — render the dynamic selectors on the parent's PDP.
 * If the parent is logged in, we use their school for school-specific pricing.
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const me = await getCurrentParent();
  const { productId } = await params;
  const schoolId =
    me?.students[0]?.school.id ?? null;
  const config = await getBundlePdpConfig({ productId, schoolId });
  if (!config) return NextResponse.json({ error: "not a bundle" }, { status: 404 });
  return NextResponse.json({ config });
}
