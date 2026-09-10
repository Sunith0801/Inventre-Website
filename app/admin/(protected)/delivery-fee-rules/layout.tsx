import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/delivery-fee-rules.
 * Slug is `delivery-fees` (see PAGE_HREF_OVERRIDES).
 *
 * Requires read or write on `delivery-fees`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["delivery-fees"]}>{children}</SectionGate>;
}
