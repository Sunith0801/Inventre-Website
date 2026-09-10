import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/settings/users.
 *
 * Requires read or write on `settings-users`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["settings-users"]}>{children}</SectionGate>;
}
