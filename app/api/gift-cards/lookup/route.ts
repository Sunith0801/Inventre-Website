import { NextResponse } from "next/server";
import { lookupGiftCard, isValidCode } from "@/server/repos/gift-cards";
import { requireParent, isResponse } from "@/server/parent-guard";

/**
 * Parent-facing gift-card preview at checkout. Returns balance + status
 * without revealing internal IDs.
 */
export async function GET(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  if (!isValidCode(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  const card = await lookupGiftCard(code);
  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (card.status !== "active") {
    return NextResponse.json(
      { error: `Card is ${card.status}` },
      { status: 410 }
    );
  }
  if (card.expiresAt && card.expiresAt < new Date()) {
    return NextResponse.json({ error: "Card has expired" }, { status: 410 });
  }
  return NextResponse.json({
    balance: card.currentBalance,
    expiresAt: card.expiresAt?.toISOString() ?? null,
  });
}
