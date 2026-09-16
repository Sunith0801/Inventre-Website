import { Truck, PackageCheck, RotateCcw } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import { getParentOrderDetailFromErp } from "@/server/erp-customer-orders";

const IST_DT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const fmt = (iso: string | null | undefined) => (iso ? IST_DT.format(new Date(iso)) : null);

function toneFor(status: string): "success" | "info" | "warning" | "danger" | "default" {
  const s = status.toLowerCase();
  if (s === "delivered") return "success";
  if (/return|lost|cancel/.test(s)) return "danger";
  if (/out for delivery|in transit|in_transit|dispatch|shipped/.test(s)) return "info";
  if (/pending/.test(s)) return "warning";
  return "default";
}
const humanise = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Delivery tracking as the parent sees it on the storefront: one block per
 * parcel stream (Bookkit, Uniform, …) and, per carrier shipment, the
 * merged timeline of audit status changes and carrier scans. Read from the
 * ERP mirror (erp.outward_shipments / packing_units) through the same
 * loader the storefront uses, so admin and customer never disagree.
 */
export async function OrderTrackingCard({ parentId, orderNumber }: { parentId: string; orderNumber: string }) {
  let detail: Awaited<ReturnType<typeof getParentOrderDetailFromErp>> = null;
  let error: string | null = null;
  try {
    detail = await getParentOrderDetailFromErp(parentId, orderNumber);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const groups = detail?.categoryGroups ?? [];
  const shipments = detail?.shipmentHistory ?? [];
  const rto = detail?.rto ?? null;

  return (
    <Card>
      <CardHeader
        title="Delivery tracking"
        description="What the parent sees on the shop — status changes from the audit ERP and carrier scans."
      />

      {error ? (
        <p className="text-[13px] text-red-700">Could not read the ERP mirror: {error}</p>
      ) : !detail || (groups.length === 0 && shipments.length === 0) ? (
        <p className="text-[13px] text-ink-500">Nothing to track yet — the order has not been packed or dispatched on the ERP.</p>
      ) : (
        <div className="space-y-5">
          {rto?.active || rto?.delivered ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-[13px] text-red-900">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <span className="font-bold">{rto.delivered ? "Returned to origin" : "Return to origin in progress"}</span>
                {rto.stage ? <span className="text-red-800"> — {rto.stage}</span> : null}
              </div>
            </div>
          ) : null}

          {groups.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => (
                <div key={g.rootCategoryId ?? g.rootCategoryName} className="rounded-xl border border-ink-100/70 bg-cream-50/50 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900">{g.rootCategoryName}</span>
                    <Badge tone={toneFor(g.status)} dot size="sm" className="capitalize">{g.status}</Badge>
                  </div>
                  <div className="mt-1 text-[12px] text-ink-500">
                    {g.deliveredQty} of {g.totalQty} delivered
                    {g.returnedQty > 0 ? ` · ${g.returnedQty} returned` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {shipments.length > 0 ? (
            <div className="space-y-4">
              {shipments.map((s, i) => (
                <div key={s.shipmentId ?? `${s.partner}-${i}`} className="rounded-xl border border-ink-100/70">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-100/70 px-4 py-3 text-[13px]">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-ink-900">
                      {s.status.toLowerCase() === "delivered" ? <PackageCheck className="h-4 w-4 text-emerald-600" /> : <Truck className="h-4 w-4 text-ink-400" />}
                      <span className="capitalize">{s.partner}</span>
                    </span>
                    {s.trackingNumber ? <span className="font-mono text-ink-600">{s.trackingNumber}</span> : null}
                    {s.itemCategory ? <span className="text-ink-500 capitalize">{s.itemCategory}</span> : null}
                    <Badge tone={toneFor(s.status)} dot size="sm">{humanise(s.status)}</Badge>
                    <span className="ml-auto text-[12px] text-ink-500">
                      {s.deliveredAt ? `Delivered ${fmt(s.deliveredAt)}` : s.dispatchedAt ? `Dispatched ${fmt(s.dispatchedAt)}` : ""}
                    </span>
                  </div>
                  {s.events.length > 0 ? (
                    <ol className="px-4 py-3">
                      {[...s.events].reverse().map((ev, j) => (
                        <li key={j} className="relative flex gap-3 pb-3 last:pb-0">
                          <span className="relative mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
                            <span className={`h-2 w-2 rounded-full ${ev.kind === "carrier" ? "bg-brand-500" : "bg-ink-300"}`} />
                            {j < s.events.length - 1 ? <span className="absolute left-1/2 top-2.5 h-[calc(100%+0.75rem)] w-px -translate-x-1/2 bg-ink-100" /> : null}
                          </span>
                          <div className="min-w-0 flex-1 text-[13px]">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium text-ink-900">{ev.label}</span>
                              <span className="text-[11.5px] text-ink-400">{ev.badge}</span>
                            </div>
                            <div className="text-[12px] text-ink-500">
                              {fmt(ev.at)}
                              {ev.source ? ` · ${ev.source}` : ""}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="px-4 py-3 text-[12.5px] text-ink-500">No scans recorded for this shipment yet.</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
