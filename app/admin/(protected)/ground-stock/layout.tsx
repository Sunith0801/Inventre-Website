import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/ground-stock.
 *
 * The page is a view over the catalog's stock bins, so it takes the same
 * permission as the catalog (read or write on `catalog`).
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["catalog"]}>{children}</SectionGate>;
}
