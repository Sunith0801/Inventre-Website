import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/master-data — the read-only browser over
 * schools, grades, customers, students and guardians. An admin needs
 * read (or write) on at least one of those; the page then checks the
 * specific entity.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SectionGate slugs={["schools", "grades", "customers", "students", "guardians"]}>
      {children}
    </SectionGate>
  );
}
