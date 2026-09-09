import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AdminShell } from "@/components/admin/AdminShell";
import VersionWatcher from "@/components/VersionWatcher";
import { isFeesScopedPermission } from "@/lib/fees-users";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") redirect("/admin/login");

  // A standalone-dashboard account (its whole permission set is fees.*) has
  // no business anywhere under /admin. Individual admin pages are gated one
  // by one and most of them predate low-trust accounts — /admin/settings/users
  // in particular server-renders every admin's email with no guard of its
  // own — so the area is closed here rather than trusting 60-odd pages to
  // each say no. Any account holding even one non-fees permission is a
  // normal staff admin and passes straight through.
  let hasAdminPermission = false;
  let hasFeesPermission = false;
  for (const p of me.permissions) {
    if (isFeesScopedPermission(p)) hasFeesPermission = true;
    else hasAdminPermission = true;
  }
  // Only bounce an account that actually has somewhere to be bounced TO.
  // Redirecting a zero-permission account would send it to /fees, which
  // would deny it and send it to the login page it already has a session
  // for — a loop. Those accounts keep the old behaviour: an empty shell.
  // Not straight to /fees: this account's admin cookie is a leftover from
  // before the two logins were split, and /fees refuses it, so that bounce
  // dead-ended on the fee login with the stale cookie still set — /admin
  // then looped there forever. The exit route clears it first.
  if (!hasAdminPermission && hasFeesPermission) redirect("/admin/fee-desk-exit");

  return (
    <AdminShell user={me}>
      {/* `careful`: /admin is full of edit forms, so once anything on the
          page has been typed into, a new build prompts instead of reloading
          and discarding the work. */}
      <VersionWatcher careful />
      {children}
    </AdminShell>
  );
}
