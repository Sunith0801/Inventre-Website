import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/students.
 *
 * Requires read or write on `students`. Covers every page
 * beneath this segment, including detail routes reached by direct URL.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["students"]}>{children}</SectionGate>;
}
