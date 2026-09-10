import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/payment-charges.
 *
 * Requires read or write on `payment-charges`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["payment-charges"]}>{children}</SectionGate>;
}
