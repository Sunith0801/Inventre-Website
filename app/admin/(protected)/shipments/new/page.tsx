"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

type OrderItem = {
  id: string;
  nameSnapshot: string;
  size: string;
  qty: number;
};

type PickableOrder = {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    total: number;
  };
  parentName: string | null;
  parentPhone: string | null;
};

export default function NewShipmentPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const orderId = sp.get("orderId") ?? "";
  const [orderNumber, setOrderNumber] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [carrier, setCarrier] = useState("delhivery");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pickable, setPickable] = useState<PickableOrder[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Without orderId, fetch shippable orders (confirmed or packed) so the user
  // can pick one. Avoids the "pass ?orderId=… in the URL" dead-end.
  useEffect(() => {
    if (orderId) return;
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/admin/orders?status=confirmed").then((r) => r.json()),
          fetch("/api/admin/orders?status=packed").then((r) => r.json()),
        ]);
        setPickable([...(a.orders ?? []), ...(b.orders ?? [])]);
      } catch (e) {
        setPickError(e instanceof Error ? e.message : "Failed to load orders");
        setPickable([]);
      }
    })();
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    void (async () => {
      const r = await fetch(`/api/admin/orders/${orderId}`);
      const data = await r.json();
      if (data.order) {
        setOrderNumber(data.order.orderNumber);
        setItems(data.order.items ?? []);
        const init: Record<string, number> = {};
        for (const it of data.order.items ?? []) init[it.id] = it.qty;
        setPicks(init);
      }
    })();
  }, [orderId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemsToShip = Object.entries(picks)
      .filter(([, q]) => q > 0)
      .map(([orderItemId, qty]) => ({ orderItemId, qty }));
    if (itemsToShip.length === 0) {
      setMsg("Pick at least one item");
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        items: itemsToShip,
        carrier: carrier || undefined,
        trackingNumber: tracking || undefined,
      }),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) {
      setMsg(`Error: ${data.error}`);
    } else {
      setMsg(`✓ ${data.shipmentNumber} created`);
      setTimeout(() => router.push(`/admin/shipments/${data.id}`), 600);
    }
  };

  if (!orderId) {
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          <h1 className="text-2xl font-bold">New shipment</h1>
          <p className="text-sm text-ink-600 mt-1">
            Pick an order to ship. Only confirmed and packed orders are shown.
          </p>
        </header>
        <div className="rounded-2xl border border-ink-100/70 bg-white overflow-hidden">
          {pickable === null ? (
            <div className="px-5 py-8 text-center text-sm text-ink-500">Loading…</div>
          ) : pickError ? (
            <div className="px-5 py-8 text-center text-sm text-red-700">
              {pickError}
            </div>
          ) : pickable.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-ink-500">
              No confirmed or packed orders waiting to ship.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-cream-50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Order #</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Customer</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-4 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {pickable.map((p) => (
                  <tr key={p.order.id} className="border-t border-ink-100">
                    <td className="px-4 py-2 font-mono text-[12px]">
                      {p.order.orderNumber}
                    </td>
                    <td className="px-4 py-2">
                      {p.parentName ?? p.parentPhone ?? "—"}
                    </td>
                    <td className="px-4 py-2 capitalize">{p.order.status}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      ₹{(p.order.total / 100).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/shipments/new?orderId=${p.order.id}`}
                        className="text-brand-700 font-semibold hover:underline"
                      >
                        Pick →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <a href={`/admin/orders/${orderId}`} className="text-sm text-brand hover:underline">
          ← Order
        </a>
        <h1 className="text-2xl font-bold mt-1">Create shipment</h1>
        <div className="text-sm text-ink-600">For order {orderNumber}</div>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <section className="border rounded-lg p-4 space-y-2">
          <h2 className="font-semibold mb-2">Pick items + quantities</h2>
          <table className="w-full text-sm">
            <thead className="bg-cream-100">
              <tr>
                <th className="px-2 py-1 text-left">Item</th>
                <th className="px-2 py-1 text-left">Size</th>
                <th className="px-2 py-1 text-right">Ordered</th>
                <th className="px-2 py-1 text-right">Ship now</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-2 py-2">{it.nameSnapshot}</td>
                  <td className="px-2 py-2">{it.size}</td>
                  <td className="px-2 py-2 text-right">{it.qty}</td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      max={it.qty}
                      value={picks[it.id] ?? 0}
                      onChange={(e) =>
                        setPicks({ ...picks, [it.id]: Number(e.target.value) })
                      }
                      className="w-20 px-2 py-1 border rounded text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="border rounded-lg p-4 space-y-3 bg-cream-50">
          <h2 className="font-semibold">Carrier (optional)</h2>
          <div className="flex gap-2">
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">— none yet —</option>
              <option value="delhivery">Delhivery</option>
              <option value="bluedart">Bluedart</option>
              <option value="dtdc">DTDC</option>
              <option value="indiapost">India Post</option>
              <option value="professional">Professional Couriers</option>
            </select>
            <input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Tracking / AWB number"
              className="flex-1 px-3 py-2 border rounded-lg"
            />
          </div>
        </section>

        <button
          type="submit"
          disabled={busy}
          className="px-6 py-2 bg-ink-900 text-white rounded-lg disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create shipment"}
        </button>
        {msg ? (
          <div className={msg.startsWith("✓") ? "text-emerald-700 text-sm" : "text-red-700 text-sm"}>
            {msg}
          </div>
        ) : null}
      </form>
    </div>
  );
}
