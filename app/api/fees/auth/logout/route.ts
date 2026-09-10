import { NextResponse } from "next/server";
import { destroyFeesSession } from "@/server/fees-auth";

/** Clears only the fee-ledger cookie — an admin session in the same browser
 *  is left alone, which is the whole point of the split. */
export async function POST() {
  await destroyFeesSession();
  return NextResponse.json({ ok: true });
}
