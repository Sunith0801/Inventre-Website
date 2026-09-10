import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { getBalance, getLedger, adjust } from "@/server/repos/loyalty";
import { logAdminActivity } from "@/server/activity";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ parentId: string }> }
) {
  const guard = await requirePermission("gift-cards.read");
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
  const guard = await requirePermission("gift-cards.write");
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
  void logAdminActivity(guard, {
    action: "loyalty.adjust",
    entityType: "customer",
    entityId: parentId,
    summary: `Loyalty ${body.delta >= 0 ? "+" : ""}${body.delta} — ${body.notes}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
