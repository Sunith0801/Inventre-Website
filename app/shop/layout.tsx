import { redirect } from "next/navigation";
import { CartProvider } from "@/lib/cart";
import { getCurrentParent } from "@/server/session";
import { readSupportView } from "@/server/support-view";
import { getSiteAccess } from "@/server/site-access";
import AccessClosed from "@/components/shop/AccessClosed";

export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use the parent-only resolver. `getCurrentUser` prefers an admin cookie
  // if one is present in the browser, which would falsely fail the
  // `kind === "parent"` check below and bounce a freshly-logged-in parent
  // back to /login.
  const user = await getCurrentParent();
  if (!user) redirect("/login");

  // Storefront closure. `students.enabled = false` already empties the
  // picker (getCurrentParent selects enabled + active rows only), so the
  // lockout itself needs no gate here — this only swaps the resulting
  // empty storefront for a screen that says why. Support agents viewing
  // as a parent are exempt: they still need to see the account to work a
  // ticket while the store is shut.
  // Access is per FAMILY, not per child. One mobile number = one account,
  // so switching off ANY student on it closes the storefront for the whole
  // account — siblings included. Showing 223 as closed while 445 shopped on
  // was the confusing half-state ops hit; this is the intended flow.
  //
  // Also covers the two other ways to land here: ops threw the master
  // switch, or every child was switched off individually. A parent with
  // zero students and none switched off is a different problem (unlinked
  // account) and still falls through to the storefront's own "we couldn't
  // find a student" empty state.
  //
  // Support agents viewing as a parent stay exempt — they need the account
  // to work a ticket while it's shut.
  if (!(await readSupportView())) {
    const anyClosed = user.closedStudents.length > 0;
    if (anyClosed || user.students.length === 0) {
      const access = await getSiteAccess();
      if (anyClosed || access.closed) {
        return <AccessClosed title={access.title} subtitle={access.subtitle} />;
      }
    }
  }

  return <CartProvider>{children}</CartProvider>;
}
