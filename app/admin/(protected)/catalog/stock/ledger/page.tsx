import { desc, eq, ilike, or, and } from "drizzle-orm";
import { ListChecks, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { db } from "@/db/client";
import {
  stockLedger,
  productVariants,
  products,
  warehouses,
} from "@/db/schema";
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
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const REASON_TONE: Record<string, "info" | "success" | "warning" | "danger" | "subtle"> = {
  receipt: "success",
  manual_adjust: "info",
  reserve: "warning",
  unreserve: "subtle",
  ship: "info",
  return: "subtle",
  audit: "subtle",
};

export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; reason?: string }>;
}) {
  const { q, reason } = await searchParams;
  const conds = [];
  if (reason)
    conds.push(eq(stockLedger.reason, reason as never));
  if (q)
    conds.push(
      or(
        ilike(productVariants.sku, `%${q}%`),
        ilike(products.name, `%${q}%`)
      )!
    );

  const rows = await db
    .select({
      ledger: stockLedger,
      sku: productVariants.sku,
      size: productVariants.size,
      productName: products.name,
      warehouseName: warehouses.name,
    })
    .from(stockLedger)
    .leftJoin(productVariants, eq(productVariants.id, stockLedger.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(warehouses, eq(warehouses.id, stockLedger.warehouseId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockLedger.createdAt))
    .limit(300);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Stock", href: "/admin/catalog/stock" },
          { label: "Ledger" },
        ]}
        title="Stock ledger"
        description="Every stock movement — manual adjustments, reservations, ships, returns. Audit trail of inventory."
      />

      <form method="GET">
        <Toolbar>
          <SearchInput
            defaultValue={q ?? ""}
            placeholder="Search by SKU or product name…"
          />
          <select
            name="reason"
            defaultValue={reason ?? ""}
            className="h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200"
          >
            <option value="">All reasons</option>
            <option value="receipt">Receipt</option>
            <option value="manual_adjust">Manual adjust</option>
            <option value="reserve">Reserve</option>
            <option value="unreserve">Unreserve</option>
            <option value="ship">Ship</option>
            <option value="return">Return</option>
            <option value="audit">Audit</option>
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </Toolbar>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No stock movements yet"
            description="Movements are recorded automatically when admins adjust stock or import bin counts."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Product</Th>
                <Th>SKU / Size</Th>
                <Th>Warehouse</Th>
                <Th>Reason</Th>
                <Th right>Δ</Th>
                <Th right>New qty</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.ledger.id}>
                  <Td muted>
                    <span className="text-[12px]">
                      {new Date(r.ledger.createdAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-medium leading-tight">
                      {r.productName ?? "—"}
                    </span>
                  </Td>
                  <Td muted>
                    <div className="font-mono text-[12px]">{r.sku ?? "—"}</div>
                    {r.size ? (
                      <div className="text-[11px] text-ink-500">{r.size}</div>
                    ) : null}
                  </Td>
                  <Td muted>{r.warehouseName ?? "—"}</Td>
                  <Td>
                    <Badge tone={REASON_TONE[r.ledger.reason] ?? "subtle"} size="sm">
                      {r.ledger.reason.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td right>
                    <span
                      className={
                        "inline-flex items-center gap-1 font-mono font-semibold " +
                        (r.ledger.delta > 0
                          ? "text-emerald-700"
                          : r.ledger.delta < 0
                            ? "text-red-700"
                            : "text-ink-500")
                      }
                    >
                      {r.ledger.delta > 0 ? (
                        <ArrowUpCircle className="h-3 w-3" />
                      ) : r.ledger.delta < 0 ? (
                        <ArrowDownCircle className="h-3 w-3" />
                      ) : null}
                      {r.ledger.delta > 0 ? "+" : ""}
                      {r.ledger.delta}
                    </span>
                  </Td>
                  <Td right>
                    <span className="font-mono tabular-nums">
                      {r.ledger.newActualQty}
                    </span>
                  </Td>
                  <Td muted className="max-w-[280px] truncate text-[12px]">
                    {r.ledger.notes ?? "—"}
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
