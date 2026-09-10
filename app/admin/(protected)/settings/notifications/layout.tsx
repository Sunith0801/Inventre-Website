import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/settings/notifications.
 * Notification settings belong to order notifications.
 *
 * Requires read or write on `order-notifications`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["order-notifications"]}>{children}</SectionGate>;
}
