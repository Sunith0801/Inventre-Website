import { Truck, ExternalLink as ExternalLinkIcon, Plus } from "lucide-react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  PageHeader,
  Card,
  Toolbar,
  FilterChips,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  statusTone,
  Button,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

type Row = {
  source: "local" | "erp_shipment" | "packing_unit";
  shipment_id: string;
  shipment_number: string;
  order_no: string;
  /** UUID of the local order row when resolvable — used to link the
   *  "Order" cell to a working /admin/orders/{id} detail page even for
   *  ERP-sourced rows where the order_no is the ERP SO name. */
  order_local_id: string | null;
  /** Parent + student names from the local DB, looked up via the
   *  order_local_id when we have it. Massively more useful than the
   *  raw `tracking_number` for an admin scanning the list. */
  customer_name: string | null;
  student_name: string | null;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  created_at: string;
  // For local shipments, the click-through detail URL.
  href: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  pending: "Pending",
  sealed: "Sealed",
  dispatched: "Dispatched",
};

const SOURCE_LABEL: Record<string, string> = {
  local: "Admin-created",
  erp_shipment: "ERP shipment",
  packing_unit: "Warehouse pack",
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const guard = await requireAnyPermission("shipments.read", "shipments.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { status } = await searchParams;

  // Three-way UNION:
  //  1. Local `shipments` table (admin-created)
  //  2. erp.outward_shipments mirror (poll-back from ERP outward dispatcher)
  //  3. erp.packing_units WHERE status='dispatched' (warehouse-packing UI flow)
  // The packing_units source is the dominant one on the new ERP — every
  // "dispatch sealed unit" click in /warehouse-packing on ERP creates one
  // of these and Inventre's poll pulls it into the mirror.
  const where = status
    ? sql`WHERE u.status = ${status}`
    : sql`WHERE TRUE`;

  // Performance note: the per-row LATERAL/correlated subquery that resolves
  // each ERP shipment back to its local orders.id was the dominant cost on
  // this page (32k erp.outward_shipments × full table scan = 8s+ before).
  // The 2026-05-26 perf pass added `orders_erp_so_name_lookup_idx` so the
  // subquery is now an index seek. We also push per-branch LIMITs so we
  // never sort more than ~600 rows for the final ORDER BY across the union.
  // Performance: each branch pre-LIMITs to its top-200 by date so the
  // outer ORDER BY never sorts more than ~600 rows. The per-row subquery
  // resolving order_no → local id uses orders_erp_so_name_lookup_idx
  // (added in the 2026-05-26 perf pass).
  const rows = rowsOf<Row>(
    await db.execute(sql`
      WITH local_ship AS (
        SELECT 'local'::text                                     AS source,
               s.id::text                                        AS shipment_id,
               COALESCE(s.shipment_number, left(s.id::text, 8))  AS shipment_number,
               o.order_number                                    AS order_no,
               o.id::text                                        AS order_local_id,
               s.status_enum::text                               AS status,
               s.courier                                         AS carrier,
               s.tracking_number                                 AS tracking_number,
               s.tracking_url                                    AS tracking_url,
               s.created_at::text                                AS created_at,
               ('/admin/shipments/' || s.id::text)               AS href
          FROM shipments s
          INNER JOIN orders o ON o.id = s.order_id
         ORDER BY s.created_at DESC
         LIMIT 200
      ),
      erp_ship AS (
        SELECT 'erp_shipment'::text                              AS source,
               ('erpship-' || x.id::text)                        AS shipment_id,
               COALESCE(NULLIF(x.tracking_number,''), x.order_erp_name) AS shipment_number,
               x.order_erp_name                                  AS order_no,
               (SELECT lo.id::text FROM orders lo
                 WHERE lo.order_number = x.order_erp_name
                    OR lo.erp_so_name  = x.order_erp_name
                 LIMIT 1)                                        AS order_local_id,
               CASE
                 WHEN x.delivered_at IS NOT NULL  THEN 'delivered'
                 WHEN x.dispatched_at IS NOT NULL THEN 'shipped'
                 ELSE COALESCE(x.status, 'pending')
               END                                               AS status,
               x.partner                                         AS carrier,
               x.tracking_number,
               NULL::text                                        AS tracking_url,
               COALESCE(x.dispatched_at, x.updated_at, NOW())::text AS created_at,
               NULL::text                                        AS href
          FROM erp.outward_shipments x
         ORDER BY COALESCE(x.dispatched_at, x.updated_at) DESC NULLS LAST
         LIMIT 200
      ),
      pack_units AS (
        SELECT 'packing_unit'::text                              AS source,
               ('pu-' || pu.id::text)                            AS shipment_id,
               pu.unit_number                                    AS shipment_number,
               pu.order_erp_name                                 AS order_no,
               (SELECT lo.id::text FROM orders lo
                 WHERE lo.order_number = pu.order_erp_name
                    OR lo.erp_so_name  = pu.order_erp_name
                 LIMIT 1)                                        AS order_local_id,
               CASE
                 WHEN pu.dispatched_at IS NOT NULL THEN 'shipped'
                 WHEN pu.sealed_at     IS NOT NULL THEN 'packed'
                 ELSE 'draft'
               END                                               AS status,
               pu.partner                                        AS carrier,
               pu.tracking_number,
               NULL::text                                        AS tracking_url,
               COALESCE(pu.dispatched_at, pu.sealed_at, pu.created_at)::text AS created_at,
               NULL::text                                        AS href
          FROM erp.packing_units pu
         WHERE pu.status IN ('sealed','dispatched')
         ORDER BY COALESCE(pu.dispatched_at, pu.sealed_at, pu.created_at) DESC
         LIMIT 200
      )
      SELECT u.source, u.shipment_id, u.shipment_number, u.order_no,
             u.order_local_id, u.status, u.carrier, u.tracking_number,
             u.tracking_url, u.created_at, u.href,
             par.name AS customer_name,
             st.name  AS student_name
        FROM (
          SELECT * FROM local_ship
          UNION ALL SELECT * FROM erp_ship
          UNION ALL SELECT * FROM pack_units
        ) u
        LEFT JOIN orders lo ON lo.id::text = u.order_local_id
        LEFT JOIN parents par ON par.id = lo.parent_id
        LEFT JOIN students st ON st.id = lo.student_id
        ${where}
       ORDER BY u.created_at DESC
       LIMIT 200
    `)
  );

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Shipments"
        description={`${rows.length} shipments · pulled from local shipments, ERP outward shipments, and warehouse packing units`}
        actions={
          <Link href="/admin/shipments/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New shipment
            </Button>
          </Link>
        }
      />

      <Toolbar>
        <FilterChips
          options={[
            { value: null, label: "All" },
            { value: "draft", label: "Draft" },
            { value: "packed", label: "Packed" },
            { value: "shipped", label: "Shipped" },
            { value: "delivered", label: "Delivered" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          value={status ?? null}
          baseHref="/admin/shipments"
        />
      </Toolbar>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={status ? `No ${status} shipments` : "No shipments yet"}
            description="Create one from an order, or dispatch a packing unit on the ERP."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Carrier / Tracking</Th>
                <Th>Shipment ref</Th>
                <Th>Source</Th>
                <Th right>Date</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // Prefer the local order's UUID for the order link so the
                // /admin/orders/[id] route resolves cleanly even when the
                // shipment row came from the ERP mirror and order_no is the
                // ERPNext SO name.
                const orderHref = `/admin/orders/${encodeURIComponent(
                  r.order_local_id ?? r.order_no
                )}`;
                const statusLabel = STATUS_LABEL[r.status] ?? r.status;
                return (
                  <Tr key={r.shipment_id}>
                    <Td>
                      <Link
                        href={orderHref}
                        className="font-mono text-[12.5px] font-semibold text-ink-900 hover:text-brand-700"
                      >
                        {r.order_no}
                      </Link>
                    </Td>
                    <Td>
                      {r.customer_name ? (
                        <div className="flex flex-col">
                          <span className="text-[13px] font-medium text-ink-900 truncate max-w-[200px]">
                            {r.customer_name}
                          </span>
                          {r.student_name ? (
                            <span className="text-[11.5px] text-ink-500 truncate max-w-[200px]">
                              for {r.student_name}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(r.status)} dot size="sm">
                        {statusLabel}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span className="text-[12px] text-ink-700">
                          {r.carrier ?? (
                            <span className="text-ink-300">No carrier</span>
                          )}
                        </span>
                        {r.tracking_number ? (
                          r.tracking_url ? (
                            <a
                              href={r.tracking_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 font-mono text-[11px] text-brand-700 hover:text-brand-800"
                            >
                              {r.tracking_number}
                              <ExternalLinkIcon className="h-2.5 w-2.5" />
                            </a>
                          ) : (
                            <span className="font-mono text-[11px] text-ink-500">
                              {r.tracking_number}
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] text-ink-300">
                            No tracking
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {r.href ? (
                        <Link
                          href={r.href}
                          className="font-mono text-[11.5px] text-ink-700 hover:text-brand-700"
                        >
                          {r.shipment_number}
                        </Link>
                      ) : (
                        <span className="font-mono text-[11.5px] text-ink-500">
                          {r.shipment_number}
                        </span>
                      )}
                    </Td>
                    <Td muted>
                      <Badge size="sm" tone={r.source === "local" ? "default" : "info"}>
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </Badge>
                    </Td>
                    <Td right muted>
                      <span className="text-[12px] tabular-nums whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
