import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/settings/payments.
 *
 * Requires read or write on `payments`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["payments"]}>{children}</SectionGate>;
}
