import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { getBalance, getLedger, adjust } from "@/lib/repos/loyalty";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ parentId: string }> }
) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { parentId } = await params;
  const [balance, ledger] = await Promise.all([
    getBalance(parentId),
    getLedger(parentId, 100),
  ]);
  return NextResponse.json({ balance, ledger });
}

const Body = z.object({
  delta: z.number().int(),
  notes: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ parentId: string }> }
) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { parentId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  await adjust({
    parentId,
    delta: body.delta,
    notes: body.notes,
    createdBy: guard.id,
  });
  return NextResponse.json({ ok: true });
}
