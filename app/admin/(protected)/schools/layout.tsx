import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/schools.
 *
 * Requires read or write on `schools`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["schools"]}>{children}</SectionGate>;
}
