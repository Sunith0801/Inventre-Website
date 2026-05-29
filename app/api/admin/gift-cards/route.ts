import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { issueGiftCard, listGiftCards } from "@/lib/repos/gift-cards";

export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const cards = await listGiftCards({ status });
  return NextResponse.json({ cards });
}

const Body = z.object({
  amountRupees: z.number().int().min(1),
  toEmail: z.string().email().nullable().optional(),
  toPhone: z.string().regex(/^\d{10}$/).nullable().optional(),
  toParentId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const result = await issueGiftCard({
    amountPaise: body.amountRupees * 100,
    toEmail: body.toEmail ?? undefined,
    toPhone: body.toPhone ?? undefined,
    toParentId: body.toParentId ?? undefined,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    notes: body.notes ?? undefined,
    createdBy: guard.id,
  });
  return NextResponse.json(result);
}
