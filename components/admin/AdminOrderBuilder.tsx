"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
};

type Student = {
  id: string;
  name: string;
  class: string | null;
  schoolId: string;
};

type Variant = {
  id: string;
  size: string;
  sku: string;
  productId: string;
  productName: string;
  basePrice: number | null;
};

type Line = { variantId: string; qty: number };

export function AdminOrderBuilder({
  schools,
}: {
  schools: { id: string; name: string }[];
}) {
  const router = useRouter();

  // Customer
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [students, setStudents] = useState<Student[]>([]);

  // Order
  const [schoolId, setSchoolId] = useState<string>("");
  const [studentId, setStudentId] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [variantOptions, setVariantOptions] = useState<Variant[]>([]);

  // Address
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Telangana");
  const [pincode, setPincode] = useState("");

  // Payment
  const [paymentMethod, setPaymentMethod] =
    useState<"cash" | "upi" | "card" | "netbanking" | "bank_transfer" | "cheque" | "other">("cash");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending">("paid");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Customer search
  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerResults([]);
      return;
    }
    let cancel = false;
    void (async () => {
      const r = await fetch(`/api/admin/customers?q=${encodeURIComponent(q)}&limit=10`);
      if (!r.ok || cancel) return;
      const data = await r.json();
      setCustomerResults(data.customers ?? []);
    })();
    return () => {
      cancel = true;
    };
  }, [customerQuery]);

  // Load students whenever a customer is picked
  useEffect(() => {
    if (!customer) {
      setStudents([]);
      return;
    }
    void (async () => {
      const r = await fetch(`/api/admin/customers/${customer.id}`);
      if (!r.ok) return;
      const data = await r.json();
      const ss = (data.customer?.students ?? []) as Student[];
      setStudents(ss);
      if (ss.length === 1) {
        setStudentId(ss[0].id);
        setSchoolId(ss[0].schoolId);
      }
      // Pre-fill receiver from parent if empty
      if (!receiverName && customer.name) setReceiverName(customer.name);
      if (!receiverPhone) setReceiverPhone(customer.phone);
    })();
  }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Product/variant search per school
  useEffect(() => {
    if (!schoolId) {
      setVariantOptions([]);
      return;
    }
    let cancel = false;
    void (async () => {
      const r = await fetch(
        `/api/admin/products?schoolId=${schoolId}&limit=200${
          productSearch ? `&q=${encodeURIComponent(productSearch)}` : ""
        }`
      );
      if (!r.ok || cancel) return;
      const data = await r.json();
      // Flatten products → variants
      type ProdRow = {
        id: string;
        name: string;
        basePrice: number | null;
        variants?: { id: string; size: string; sku: string }[];
      };
      const variants: Variant[] = [];
      for (const p of (data.products ?? []) as ProdRow[]) {
        for (const v of p.variants ?? []) {
          variants.push({
            id: v.id,
            size: v.size,
            sku: v.sku,
            productId: p.id,
            productName: p.name,
            basePrice: p.basePrice,
          });
        }
      }
      setVariantOptions(variants);
    })();
    return () => {
      cancel = true;
    };
  }, [schoolId, productSearch]);

  const variantById = useMemo(() => {
    return new Map(variantOptions.map((v) => [v.id, v]));
  }, [variantOptions]);

  const addLine = (variantId: string) => {
    const existing = lines.find((l) => l.variantId === variantId);
    if (existing) {
      setLines(
        lines.map((l) =>
          l.variantId === variantId ? { ...l, qty: l.qty + 1 } : l
        )
      );
    } else {
      setLines([...lines, { variantId, qty: 1 }]);
    }
  };

  const subtotal = useMemo(() => {
    let s = 0;
    for (const l of lines) {
      const v = variantById.get(l.variantId);
      if (!v) continue;
      s += (v.basePrice ?? 0) * l.qty;
    }
    return s;
  }, [lines, variantById]);

  const createCustomer = () => {
    setError(null);
    start(async () => {
      const r = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: newPhone.trim(),
          name: newName.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed to create customer");
        return;
      }
      setCustomer({
        id: data.id,
        phone: newPhone,
        name: newName || null,
        email: null,
      });
      setShowNewCustomer(false);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customer) {
      setError("Pick or create a customer");
      return;
    }
    if (!schoolId) {
      setError("Pick a school");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one item");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: customer.id,
          studentId: studentId || undefined,
          schoolId,
          items: lines,
          shippingAddress: {
            receiverName,
            receiverPhone,
            line1,
            line2: line2 || undefined,
            city,
            state,
            pincode,
          },
          paymentMethod,
          paymentStatus,
          paymentReference: paymentReference || null,
          notes: notes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed to create order");
        return;
      }
      router.push(`/admin/orders/${data.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-7">
      {/* CUSTOMER */}
      <Section title="Customer">
        {customer ? (
          <div className="flex items-center justify-between bg-cream-50/60 border border-ink-100/70 rounded-xl px-4 py-2">
            <div>
              <div className="font-semibold">
                {customer.name ?? "Unnamed"} · {customer.phone}
              </div>
              {customer.email ? (
                <div className="text-[12px] text-ink-500">{customer.email}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setCustomer(null);
                setStudents([]);
                setStudentId("");
                setSchoolId("");
                setLines([]);
              }}
              className="text-[13px] text-ink-500 hover:text-red-700"
            >
              Clear
            </button>
          </div>
        ) : showNewCustomer ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Field label="Phone" required>
              <input
                type="text"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                pattern="[0-9]{10}"
                placeholder="10-digit"
                className={inputClass}
              />
            </Field>
            <Field label="Name">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="lg:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewCustomer(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={createCustomer}
                disabled={!/^\d{10}$/.test(newPhone.trim())}
                busy={pending}
              >
                Create &amp; pick
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search by phone, name, or email…"
                className={inputClass + " pl-9"}
              />
            </div>
            {customerResults.length > 0 ? (
              <ul className="border border-ink-100/70 rounded-xl bg-white divide-y divide-ink-100/50 max-h-56 overflow-y-auto">
                {customerResults.map((c) => (
                  <li
                    key={c.id}
                    className="px-3 py-2 hover:bg-cream-50 cursor-pointer text-[13px]"
                    onClick={() => {
                      setCustomer(c);
                      setCustomerResults([]);
                      setCustomerQuery("");
                    }}
                  >
                    <span className="font-medium">{c.name ?? "Unnamed"}</span>
                    <span className="text-ink-500 ml-2">{c.phone}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => setShowNewCustomer(true)}
              className="text-[13px] text-brand-700 hover:text-brand-800 font-semibold inline-flex items-center gap-1"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Or create a new customer
            </button>
          </div>
        )}
      </Section>

      {/* SCHOOL + STUDENT */}
      {customer ? (
        <Section title="School & student">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Field label="School" required>
              <select
                value={schoolId}
                onChange={(e) => {
                  setSchoolId(e.target.value);
                  setStudentId("");
                  setLines([]);
                }}
                required
                className={inputClass}
              >
                <option value="">— Pick school —</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Student" hint="Optional — links order to a student">
              <select
                value={studentId}
                onChange={(e) => {
                  const s = students.find((x) => x.id === e.target.value);
                  setStudentId(e.target.value);
                  if (s) setSchoolId(s.schoolId);
                }}
                className={inputClass}
              >
                <option value="">No student / parent only</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.class ? ` · Class ${s.class}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>
      ) : null}

      {/* ITEMS */}
      {schoolId ? (
        <Section title="Items">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products…"
              className={inputClass + " pl-9"}
            />
          </div>
          <div className="border border-ink-100/70 rounded-xl bg-white max-h-56 overflow-y-auto mb-4">
            {variantOptions.length === 0 ? (
              <div className="px-3 py-4 text-[13px] text-ink-500">
                {productSearch ? "No matching variants" : "Type to search products"}
              </div>
            ) : (
              <ul className="divide-y divide-ink-100/50">
                {variantOptions.slice(0, 50).map((v) => (
                  <li
                    key={v.id}
                    className="px-3 py-2 hover:bg-cream-50 flex items-center gap-3 text-[13px]"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{v.productName}</div>
                      <div className="text-[11px] text-ink-500">
                        {v.size} · <span className="font-mono">{v.sku}</span>
                      </div>
                    </div>
                    <div className="tabular-nums w-20 text-right">
                      ₹{v.basePrice != null ? (v.basePrice / 100).toFixed(2) : "—"}
                    </div>
                    <button
                      type="button"
                      onClick={() => addLine(v.id)}
                      className="text-brand-700 hover:text-brand-800 p-1"
                      aria-label="Add item"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lines.length > 0 ? (
            <table className="w-full text-[13px]">
              <thead className="bg-cream-50">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right w-24">Qty</th>
                  <th className="px-3 py-2 text-right w-28">Total</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const v = variantById.get(l.variantId);
                  if (!v) return null;
                  const unit = v.basePrice ?? 0;
                  return (
                    <tr key={l.variantId} className="border-t border-ink-100/70">
                      <td className="px-3 py-2">
                        <div className="font-medium">{v.productName}</div>
                        <div className="text-[11px] text-ink-500">{v.size}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        ₹{(unit / 100).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          value={l.qty}
                          onChange={(e) =>
                            setLines(
                              lines.map((x) =>
                                x.variantId === l.variantId
                                  ? { ...x, qty: Math.max(1, Number(e.target.value)) }
                                  : x
                              )
                            )
                          }
                          className={inputClass + " text-right w-20"}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        ₹{((unit * l.qty) / 100).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setLines(lines.filter((x) => x.variantId !== l.variantId))
                          }
                          className="text-ink-400 hover:text-red-600"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-ink-200 bg-cream-50">
                  <td className="px-3 py-2" colSpan={3}>
                    <span className="font-semibold">Subtotal</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    ₹{(subtotal / 100).toFixed(2)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </Section>
      ) : null}

      {/* SHIPPING */}
      {lines.length > 0 ? (
        <Section title="Shipping address">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Field label="Receiver name" required>
              <input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Receiver phone" required>
              <input
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                pattern="[0-9]{10}"
                required
                className={inputClass}
              />
            </Field>
            <Field label="Address line 1" required className="lg:col-span-2">
              <input
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Address line 2" className="lg:col-span-2">
              <input
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="City" required>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="State" required>
              <input
                value={state}
                onChange={(e) => setState(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Pincode" required>
              <input
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                pattern="[0-9]{6}"
                required
                className={inputClass}
              />
            </Field>
          </div>
        </Section>
      ) : null}

      {/* PAYMENT */}
      {lines.length > 0 ? (
        <Section title="Payment">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Field label="Method" required>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as typeof paymentMethod)
                }
                className={inputClass}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="netbanking">Netbanking</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Status" required>
              <select
                value={paymentStatus}
                onChange={(e) =>
                  setPaymentStatus(e.target.value as "paid" | "pending")
                }
                className={inputClass}
              >
                <option value="paid">Paid in full</option>
                <option value="pending">Pending (collect later)</option>
              </select>
            </Field>
            <Field label="Reference" hint="UPI ref / cheque #">
              <input
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Notes" className="lg:col-span-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className={inputClass + " py-2 h-auto"}
              />
            </Field>
          </div>
        </Section>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100/70">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Create order · ₹{(subtotal / 100).toFixed(2)}
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold text-ink-900 tracking-[0.04em] uppercase mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}
