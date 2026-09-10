import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/purchase-receipts.
 * Part of the purchase-order chain.
 *
 * Requires read or write on `purchase-orders`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["purchase-orders"]}>{children}</SectionGate>;
}
