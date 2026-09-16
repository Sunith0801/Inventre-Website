import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/payments.
 * The manual ledger beneath this path is its own module, so holding either opens the section.
 *
 * Requires read or write on `payments` or `payment-entries`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["payments", "payment-entries"]}>{children}</SectionGate>;
}
