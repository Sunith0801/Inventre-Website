import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/parent-concerns.
 * Parent concerns arrive through the same intake as contact forms.
 *
 * Requires read or write on `contact-forms`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["contact-forms"]}>{children}</SectionGate>;
}
