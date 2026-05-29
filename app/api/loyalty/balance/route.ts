import { NextResponse } from "next/server";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { getBalance } from "@/lib/repos/loyalty";

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const balance = await getBalance(me.id);
  return NextResponse.json({ balance });
}
