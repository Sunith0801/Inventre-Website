"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Package, ChevronRight, GraduationCap } from "lucide-react";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { derivePlacement, describePaymentStatus } from "@/lib/order-display";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

type OrderItem = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  itemCount: number;
  thumbUrl: string | null;
  studentName: string | null;
  enrollment: string | null;
  paymentStatusRaw: string | null;
};

type StudentGroup = {
  key: string;
  studentName: string | null;
  enrollment: string | null;
  // Latest order timestamp in this group — used to order students so the
  // child with the most recent activity appears first.
  latest: number;
  orders: OrderItem[];
};

const statusStyle: Record<string, string> = {
  placed: "bg-cream-200 text-ink-700",
  confirmed: "bg-blue-50 text-blue-700",
  packed: "bg-amber-50 text-amber-700",
  shipped: "bg-indigo-50 text-indigo-700",
  "in transit": "bg-amber-100 text-amber-800",
  "out for delivery": "bg-indigo-100 text-indigo-800",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
  returned: "bg-zinc-100 text-zinc-700",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/orders", { cache: "no-store" });
      const d = await r.json();
      const list = (d.orders ?? []) as OrderItem[];
      setOrders(list);
      // Visiting this page counts as "seen" — record each order's current
      // status so the shop-home update banner doesn't replay them later.
      if (typeof window !== "undefined") {
        try {
          const seen = JSON.parse(
            window.localStorage.getItem("inv:orderStatusSeen") || "{}"
          ) as Record<string, string>;
          for (const o of list) seen[o.id] = o.status;
          window.localStorage.setItem(
            "inv:orderStatusSeen",
            JSON.stringify(seen)
          );
        } catch {}
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);
  // Refresh order list whenever the tab regains focus — admin status
  // changes (placed → shipped → delivered) appear without manual refresh.
  useFocusRefetch(loadOrders);

  // Group orders by student so a parent with multiple kids sees one block
  // per child instead of an interleaved list. Group identity normalises
  // the enrollment string to (lowercase-alpha):(digits) so the audit-side
  // form "KS240005" and our local form "24KS0005" collapse into the same
  // group instead of rendering as two sections for the same kid.
  const enrollmentKey = (s: string | null | undefined): string => {
    if (!s) return "";
    const alpha = s.replace(/[^a-zA-Z]/g, "").toLowerCase();
    const digits = s.replace(/\D/g, "");
    return `${alpha}:${digits}`;
  };
  const groups: StudentGroup[] = useMemo(() => {
    const byKey = new Map<string, StudentGroup>();
    for (const o of orders) {
      const key =
        enrollmentKey(o.enrollment) ||
        (o.studentName ?? "unassigned").trim().toLowerCase();
      const ts = new Date(o.createdAt).getTime();
      const existing = byKey.get(key);
      if (existing) {
        existing.orders.push(o);
        if (ts > existing.latest) existing.latest = ts;
        // Prefer the canonical local enrollment string (typically the
        // students.enrollment_number form) once we've seen it — that's
        // what the parent recognises. Audit's "KS240005" should defer
        // to our "24KS0005" if both turn up.
        if (!existing.enrollment && o.enrollment) {
          existing.enrollment = o.enrollment;
        }
      } else {
        byKey.set(key, {
          key,
          studentName: o.studentName,
          enrollment: o.enrollment,
          latest: ts,
          orders: [o],
        });
      }
    }
    // Most-recent activity first across students; within each student
    // orders keep the chronological order from the API (newest first).
    return Array.from(byKey.values()).sort((a, b) => b.latest - a.latest);
  }, [orders]);

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-4xl px-5 lg:px-8 pt-8 pb-16">
        <a
          href="/shop"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to shop
        </a>
        <h1 className="mt-4 font-display text-[34px] sm:text-[42px] font-extrabold tracking-tight text-ink-900">
          Your orders
        </h1>

        {!loaded ? (
          <div className="mt-8 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-white border border-ink-100 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-ink-200 bg-white p-16 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-cream-100 grid place-items-center text-ink-500">
              <Package className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-[20px] font-bold text-ink-900">
              No orders yet
            </h2>
            <p className="mt-1 text-[14px] text-ink-500">
              When you place an order, it will show up here.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {groups.map((g) => (
              <section key={g.key}>
                <header className="flex items-center gap-3 mb-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-cream-200 text-ink-700">
                    <GraduationCap className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-[18px] font-extrabold text-ink-900 truncate">
                      {g.studentName ?? "Unassigned"}
                    </h2>
                    <p className="text-[12px] text-ink-500">
                      {g.enrollment ? (
                        <>
                          <span className="font-mono">{g.enrollment}</span>
                          <span className="mx-1.5">·</span>
                        </>
                      ) : null}
                      {g.orders.length} {g.orders.length === 1 ? "order" : "orders"}
                    </p>
                  </div>
                </header>

                <ul className="space-y-3">
                  {g.orders.map((o) => (
                    <li key={o.id}>
                      <a
                        href={`/shop/orders/${o.id}`}
                        className="block rounded-2xl border border-ink-100 bg-white p-4 hover:border-ink-300 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-16 w-16 shrink-0 rounded-xl bg-cream-100 border border-ink-100 overflow-hidden">
                            {o.thumbUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={o.thumbUrl}
                                alt=""
                                className="h-full w-full object-contain p-2"
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display text-[14px] font-bold text-ink-900">
                                {o.orderNumber}
                              </span>
                              {(() => {
                                // Show "Not placed" / "Processing" for unpaid
                                // checkouts so an abandoned order doesn't read
                                // as a real "Placed" one (matches detail page).
                                const placement = derivePlacement(o);
                                const label =
                                  placement === "not_placed"
                                    ? "Not placed"
                                    : placement === "processing"
                                      ? "Processing"
                                      : o.status;
                                const style =
                                  placement === "not_placed"
                                    ? "bg-amber-100 text-amber-800"
                                    : placement === "processing"
                                      ? "bg-blue-50 text-blue-700"
                                      : statusStyle[o.status] ?? statusStyle.placed;
                                return (
                                  <span
                                    className={`text-[10px] font-bold tracking-wider uppercase rounded-full px-2 py-0.5 ${style}`}
                                  >
                                    {label}
                                  </span>
                                );
                              })()}
                            </div>
                            <p className="mt-1 text-[12px] text-ink-500">
                              {o.itemCount} {o.itemCount === 1 ? "item" : "items"} ·{" "}
                              {new Date(o.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </p>
                            {(() => {
                              // For an abandoned checkout, surface the actual
                              // CCAvenue status word + a short meaning so the
                              // parent sees why it didn't go through.
                              if (derivePlacement(o) !== "not_placed") return null;
                              const info = describePaymentStatus(o.paymentStatusRaw);
                              if (!info) return null;
                              return (
                                <p className="mt-0.5 text-[11.5px] leading-snug text-amber-700">
                                  {info.statusWord} — {info.description}
                                </p>
                              );
                            })()}
                          </div>
                          <div className="text-right">
                            <p className="font-display text-[16px] font-extrabold text-ink-900">
                              ₹{o.total.toLocaleString()}
                            </p>
                            <ChevronRight className="ml-auto mt-1 h-4 w-4 text-ink-400" />
                          </div>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
