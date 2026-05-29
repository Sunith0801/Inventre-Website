import { redirect } from "next/navigation";
import { CartProvider } from "@/lib/cart";
import { getCurrentParent } from "@/lib/session";

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
  return <CartProvider>{children}</CartProvider>;
}
