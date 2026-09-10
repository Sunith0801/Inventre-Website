import { redirect } from "next/navigation";
import { getFeesViewer } from "@/server/fees-auth";
import FeesLoginForm from "./FeesLoginForm";

export const dynamic = "force-dynamic";

/**
 * The fee ledger's own sign-in, separate from /admin/login.
 *
 * Two doors, two sessions: signing in here never issues an admin cookie, and
 * signing in at /admin/login never issues this one — so a browser can hold
 * both, and a fee-desk account cannot reach /admin at all.
 */
export default async function FeesLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; stale_admin?: string }>;
}) {
  const { from, stale_admin } = await searchParams;
  if (await getFeesViewer()) redirect(from && from.startsWith("/fees") ? from : "/fees");
  return (
    <FeesLoginForm
      next={from && from.startsWith("/fees") ? from : "/fees"}
      // Set by /admin/fee-desk-exit: this browser arrived carrying a fee-desk
      // account's stale admin cookie, which we just cleared. Say so, or the
      // parachute into a different login page looks like a bug.
      staleAdmin={stale_admin === "1"}
    />
  );
}
