import { NextResponse } from "next/server";
import { requireParent, isResponse } from "@/server/parent-guard";
import { getBalance } from "@/server/repos/loyalty";

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const balance = await getBalance(me.id);
  return NextResponse.json({ balance });
}
