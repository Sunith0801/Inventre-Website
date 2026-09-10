import { NextResponse } from "next/server";
import { getCategoryTree } from "@/server/repos/categories";

export async function GET() {
  const tree = await getCategoryTree();
  return NextResponse.json({ tree });
}
