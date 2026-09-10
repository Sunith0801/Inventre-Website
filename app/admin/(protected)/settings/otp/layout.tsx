import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/settings/otp.
 *
 * Requires read or write on `settings-otp`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["settings-otp"]}>{children}</SectionGate>;
}
