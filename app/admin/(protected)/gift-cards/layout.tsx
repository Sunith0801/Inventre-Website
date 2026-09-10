import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/gift-cards.
 *
 * Requires read or write on `gift-cards`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["gift-cards"]}>{children}</SectionGate>;
}
