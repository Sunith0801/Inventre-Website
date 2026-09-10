import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/otp-logs.
 *
 * Requires read or write on `otp-logs`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["otp-logs"]}>{children}</SectionGate>;
}
