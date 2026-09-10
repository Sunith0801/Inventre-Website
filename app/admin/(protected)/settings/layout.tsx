import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/settings.
 * A hub page: any settings-owned permission opens the index; each subsection gates itself.
 *
 * Requires read or write on `settings-users` or `settings-otp` or `settings-erp-bridge` or `roles` or `payments` or `shipments` or `order-notifications`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["settings-users", "settings-otp", "settings-erp-bridge", "roles", "payments", "shipments", "order-notifications"]}>{children}</SectionGate>;
}
