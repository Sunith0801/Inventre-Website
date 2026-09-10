import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/catalog.
 *
 * Requires read or write on `catalog`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["catalog"]}>{children}</SectionGate>;
}
