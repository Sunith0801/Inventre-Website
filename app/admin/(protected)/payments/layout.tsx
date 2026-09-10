import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/payments.
 * The CCAvenue log lives beneath this path but is its own permission, so holding either opens the section.
 *
 * Requires read or write on `payments` or `payments-ccavenue`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["payments", "payments-ccavenue"]}>{children}</SectionGate>;
}
