import { NextResponse } from "next/server";
import { getCurrentParent } from "@/lib/session";
import { getProductBySlug } from "@/lib/repos/products";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const me = await getCurrentParent();
  if (!me)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Multi-student: scope the PDP to ?studentId= when supplied, else
  // default to the first linked student.
  const url = new URL(req.url);
  const requestedId = url.searchParams.get("studentId");
  const active =
    (requestedId && me.students.find((s) => s.id === requestedId)) ||
    me.students[0];
  const schoolId = active?.school.id;

  const product = await getProductBySlug(slug, schoolId);
  if (!product)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ product });
}
