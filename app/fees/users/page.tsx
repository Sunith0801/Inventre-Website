import { redirect } from "next/navigation";
import { getFeesViewer, viewerHas } from "@/server/fees-auth";
import FeeUsersConsole from "./FeeUsersConsole";

export const dynamic = "force-dynamic";

/**
 * /fees/users — who can open the fee ledger.
 *
 * Deliberately not /admin/settings/users: that page edits every admin
 * account, so handing a fee-desk admin the permission for it would let them
 * reset the super admin's password or widen their own access. This page can
 * only see and touch fee-ledger accounts. The rules live in lib/fees-users.ts
 * and are enforced in app/api/admin/fees/users/route.ts.
 */
export default async function FeeUsersPage() {
  const me = await getFeesViewer();
  if (!viewerHas(me, "fees-users.write")) redirect("/fees/login?from=%2Ffees%2Fusers");

  return <FeeUsersConsole currentEmail={me?.email ?? ""} />;
}
