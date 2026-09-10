import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/exchanges.
 * Slug is `spoc-exchange` (see PAGE_HREF_OVERRIDES).
 *
 * Requires read or write on `spoc-exchange`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["spoc-exchange"]}>{children}</SectionGate>;
}
