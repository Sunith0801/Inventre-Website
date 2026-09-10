import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/reports.
 *
 * Requires read or write on `reports`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["reports"]}>{children}</SectionGate>;
}
