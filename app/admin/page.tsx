import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { firstAccessiblePath } from "@/lib/admin-permissions";
import { isFeesScopedPermission } from "@/lib/fees-users";

export default async function AdminIndex() {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") redirect("/admin/login");

  // This page sits OUTSIDE the (protected) group, so the layout's fee-desk
  // guard never runs here. Repeat it: a fee-only account landing on /admin
  // would otherwise be sent to its first "accessible" page — /fees — which
  // refuses the admin cookie and bounces to /fees/login with the cookie
  // still set, so /admin looped there forever. Clear it and hand over once.
  let onlyFees = me.permissions.size > 0;
  for (const p of me.permissions) {
    if (!isFeesScopedPermission(p)) {
      onlyFees = false;
      break;
    }
  }
  if (onlyFees) redirect("/admin/fee-desk-exit");
  // Land on the first page this admin can actually see. Dashboard is first
  // in ADMIN_PAGES, so full-access admins still land there; restricted
  // roles skip straight to their first permitted page (no redirect loop).
  redirect(firstAccessiblePath(me.permissions) ?? "/admin/dashboard");
}
