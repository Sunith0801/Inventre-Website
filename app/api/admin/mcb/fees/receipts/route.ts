import { NextRequest, NextResponse } from "next/server";
import { getFeesViewer, viewerHas } from "@/lib/fees-auth";
import { lookupReceipts, mcbConfigured } from "@/lib/mcb/receipts";

/**
 * Real fee receipts for one student, for the ledger's expand panel.
 *
 * All the lookup logic — stored copy first, live MCB fallback for a student
 * the nightly importer hasn't reached — lives in lib/mcb/receipts.ts, shared
 * with the printable receipt page so the two can never disagree about
 * whether a receipt exists.
 *
 * MCB publishes no receipt PDF: none of the 615 endpoints in their swagger
 * returns a receipt document. What this serves is the receipt *record*.
 */
export async function GET(req: NextRequest) {
  const me = await getFeesViewer();
  if (!viewerHas(me, "fees.read", "fees.write", "mcb.read", "mcb.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const u = req.nextUrl.searchParams;
  const enrolment = (u.get("enrolment") ?? "").trim().slice(0, 64);
  if (!enrolment) {
    return NextResponse.json({ error: "enrolment is required" }, { status: 400 });
  }
  const ayRaw = (u.get("ay") ?? "").trim();
  const ay = /^\d{4}-\d{4}$/.test(ayRaw) ? ayRaw : null;

  if (!mcbConfigured()) {
    return NextResponse.json(
      { error: "MCB credentials are not configured on this server", receipts: [] },
      { status: 503 }
    );
  }

  const { receipts, source, errors } = await lookupReceipts(enrolment, ay);
  return NextResponse.json({
    enrolment,
    receipts,
    total: receipts.reduce((s, x) => s + x.amount, 0),
    source,
    errors,
  });
}
