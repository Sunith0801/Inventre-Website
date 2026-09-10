import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/customers.
 *
 * Requires read or write on `customers`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["customers"]}>{children}</SectionGate>;
}
