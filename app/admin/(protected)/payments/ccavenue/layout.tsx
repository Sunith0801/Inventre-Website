import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/payments/ccavenue.
 *
 * Requires read or write on `payments-ccavenue`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["payments-ccavenue"]}>{children}</SectionGate>;
}
