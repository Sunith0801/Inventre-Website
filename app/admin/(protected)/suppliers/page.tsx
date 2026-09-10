import Link from "next/link";
import { Truck, Plus } from "lucide-react";
import { listSuppliers } from "@/server/repos/suppliers";
import {
  PageHeader,
  Card,
  Toolbar,
  SearchInput,
  Button,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  statusTone,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const guard = await requireAnyPermission("suppliers.read", "suppliers.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q } = await searchParams;
  const rows = await listSuppliers(q);

  return (
    <div>
      <PageHeader
        eyebrow="Buying"
        title="Suppliers"
        description={`${rows.length} suppliers · vendors who fulfill your purchase orders`}
        actions={
          <Link href="/admin/suppliers/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Add supplier
            </Button>
          </Link>
        }
      />

      <form method="GET">
        <Toolbar>
          <SearchInput
            defaultValue={q ?? ""}
            placeholder="Search by name or code…"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Toolbar>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={q ? `No suppliers match “${q}”` : "No suppliers yet"}
            description="Add a supplier to start tracking purchase orders and inbound stock."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>GSTIN</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link
                      href={`/admin/suppliers/${s.id}`}
                      className="font-mono text-[12px] font-semibold text-ink-900 hover:text-brand-700 transition-colors"
                    >
                      {s.supplierCode}
                    </Link>
                  </Td>
                  <Td>
                    <div className="font-medium text-ink-900">{s.name}</div>
                    {s.email ? (
                      <div className="text-[11px] text-ink-500">{s.email}</div>
                    ) : null}
                  </Td>
                  <Td muted>
                    <div>{s.contactName ?? "—"}</div>
                    {s.phone ? (
                      <div className="text-[11px] font-mono text-ink-500">{s.phone}</div>
                    ) : null}
                  </Td>
                  <Td muted>
                    <span className="font-mono text-[12px]">{s.gstin ?? "—"}</span>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(s.status)} dot size="sm">
                      {s.status}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
