import Link from "next/link";
import { db } from "@/db/client";
import { taxRates, hsnCodes } from "@/db/schema";
import { Receipt, Plus, Hash } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  Th,
  Td,
  Tr,
  Badge,
  Button,
  EmptyState,
  SectionTitle,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function TaxRatesPage() {
  const rates = await db.select().from(taxRates);
  const codes = await db.select().from(hsnCodes);

  return (
    <div>
      <PageHeader
        eyebrow="Pricing & Tax"
        title="Tax & GST"
        description="Tax-rate slabs and HSN classifications used by the GST engine. In-state vs out-state is auto-detected by pincode; per-item GST treatment overrides any rate."
        actions={
          <Link href="/admin/tax/rates/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New rate
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Tax rates */}
        <Card padded={false}>
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader title="Tax rates" description={`${rates.length} configured slabs`} />
          </div>
          {rates.length === 0 ? (
            <EmptyState icon={Receipt} title="No tax rates" />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th right>CGST</Th>
                  <Th right>SGST</Th>
                  <Th right>IGST</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <div className="font-medium">{r.name}</div>
                      {r.hsnPattern ? (
                        <div className="text-[11px] font-mono text-ink-500 mt-0.5">
                          HSN: {r.hsnPattern}
                        </div>
                      ) : null}
                    </Td>
                    <Td right>{Number(r.cgstRate)}%</Td>
                    <Td right>{Number(r.sgstRate)}%</Td>
                    <Td right>{Number(r.igstRate)}%</Td>
                    <Td>
                      {r.isDefault ? (
                        <Badge tone="brand" size="sm">
                          Default
                        </Badge>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* HSN codes */}
        <Card padded={false}>
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader title="HSN codes" description={`${codes.length} codes registered`} />
          </div>
          {codes.length === 0 ? (
            <EmptyState icon={Hash} title="No HSN codes" />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Description</Th>
                  <Th right>Default rate</Th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <Tr key={c.code}>
                    <Td>
                      <span className="font-mono text-[12px] font-semibold">{c.code}</span>
                    </Td>
                    <Td>
                      <div className="leading-tight">{c.description}</div>
                      {c.category ? (
                        <Badge tone="subtle" size="sm" className="mt-1">
                          {c.category}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td right>
                      {c.defaultGstRate != null ? (
                        <span className="tabular-nums">{Number(c.defaultGstRate)}%</span>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
