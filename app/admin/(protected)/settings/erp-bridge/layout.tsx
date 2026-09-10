import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/settings/erp-bridge.
 *
 * Requires read or write on `settings-erp-bridge`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["settings-erp-bridge"]}>{children}</SectionGate>;
}
