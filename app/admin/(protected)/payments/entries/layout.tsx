import { SectionGate } from "@/components/admin/SectionGate";

/**
 * Authorization gate for /admin/payments/entries — the manual ledger is its
 * own module (`payment-entries.*`), separate from the gateway log above it.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionGate slugs={["payment-entries"]}>{children}</SectionGate>;
}
