import { NextResponse } from "next/server";
import { destroyFeesSession } from "@/server/fees-auth";
import { destroyAdminSession, getCurrentUser } from "@/server/session";

/**
 * Sign out of the fee ledger.
 *
 * A staff admin never holds a fee-desk cookie — /fees admits them on their
 * admin session. Clearing only `inv_fees` therefore did nothing for them:
 * the admin cookie signed them straight back in and /fees/login bounced
 * them to /fees, so "Sign out" looked broken (it was, for every staff user).
 *
 * Now both go: the fee-desk cookie always, and the admin session whenever
 * one is present, because it is the thing that would otherwise keep the
 * ledger open. Sign out means signed out.
 */
export async function POST() {
  await destroyFeesSession();
  const me = await getCurrentUser().catch(() => null);
  const hadAdmin = Boolean(me && me.kind === "admin");
  if (hadAdmin) await destroyAdminSession();
  return NextResponse.json({ ok: true, adminCleared: hadAdmin });
}
