import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/lib/admin-guard";

/**
 * RETIRED — used to trigger a one-shot pull from ERPNext at
 * erp.inventre.in. That host is decommissioned (2026-05) and the legacy
 * data has been fully imported into the local DB, so the action is no
 * longer meaningful. Returning 410 Gone with a friendly message instead
 * of leaving the admin spinning for ~2 minutes on a dead-host fetch.
 */
const RETIRED_MSG =
  "ERPNext pull is retired. The legacy ERPNext (erp.inventre.in) is " +
  "decommissioned and all data is already imported locally. Future ERP " +
  "syncs will go through the live ERP bridge (ERP_TARGET in .env.deploy).";

export async function POST() {
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  return NextResponse.json({ error: RETIRED_MSG }, { status: 410 });
}

export async function GET() {
  const guard = await requirePermission("settings-erp-bridge.read");
  if (isResponse(guard)) return guard;
  return NextResponse.json({ configured: false, retired: true });
}
