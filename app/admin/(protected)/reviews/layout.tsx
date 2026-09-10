import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/reviews.
 *
 * Requires read or write on `reviews`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["reviews"]}>{children}</SectionGate>;
}
