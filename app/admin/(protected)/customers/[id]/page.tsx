import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, Mail, GraduationCap, ArrowUpRight } from "lucide-react";
import { getCustomerDetail } from "@/server/repos/customers";
import { AddressBook } from "@/components/admin/AddressBook";
import { RecordHistory } from "@/components/admin/RecordHistory";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Money,
  Badge,
  statusTone,
  Th,
  Td,
  Tr,
  EmptyState,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const fmtDate = (d: string | null | undefined) => (d ? IST.format(new Date(d)) : null);

/**
 * One customer (parent account). Reads top to bottom the way an operator
 * asks about a family: who they are and how much they buy → which students
 * they shop for → where things ship → what they ordered.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await getCustomerDetail(id);
  if (!c) notFound();

  const title = c.name?.trim() || c.phone;

  return (
    <div>
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        breadcrumb={[{ label: "Customers", href: "/admin/customers" }, { label: title }]}
        title={title}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1 font-medium text-ink-700">
              <Phone className="h-3.5 w-3.5" /> <span className="font-mono">{c.phone}</span>
            </span>
            {c.email ? (
              <span className="inline-flex items-center gap-1 font-medium text-ink-700">
                <Mail className="h-3.5 w-3.5" /> {c.email}
              </span>
            ) : null}
            <Badge tone={c.status === "active" ? "success" : "danger"} dot size="sm">
              {c.status}
            </Badge>
          </span>
        }
      />

      {/* Vitals */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Lifetime value" value={<Money paise={c.totalLifetimeValue} />} hint="Paid orders" />
        <Stat label="Orders" value={c.totalOrderCount} hint="Excluding cancelled" />
        <Stat
          label="Last order"
          value={<span className="text-[20px]">{fmtDate(c.lastOrderAt) ?? <span className="text-ink-300">—</span>}</span>}
        />
        <Stat label="Customer since" value={<span className="text-[20px]">{fmtDate(c.createdAt)}</span>} />
      </div>

      {/* Students — the family; one tile per child */}
      <Card padded={false} className="mb-5">
        <div className="px-5 pt-5 lg:px-6">
          <CardHeader title="Students" description={`${c.students.length} linked to this account`} className="mb-3" />
        </div>
        {c.students.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-ink-500 lg:px-6">No students attached — the parent has not been granted access to any student yet.</p>
        ) : (
          <div className="flex flex-wrap border-t border-ink-100/70">
            {c.students.map((s) => (
              <Link
                key={s.id}
                href={`/admin/students/${s.id}`}
                className="group flex w-full items-start gap-3 border-b border-r border-ink-100/70 px-5 py-4 transition-colors hover:bg-cream-50/80 sm:w-1/2 xl:w-1/4"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
                  <GraduationCap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[13px] font-semibold text-ink-900 group-hover:text-brand-700">
                    <span className="truncate">{s.name}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-ink-300 group-hover:text-brand-600" />
                  </div>
                  <div className="truncate text-[12px] text-ink-500">{s.schoolName}</div>
                  <div className="text-[12px] text-ink-500">
                    {s.class ?? "—"}
                    {s.section ? ` · ${s.section}` : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Saved addresses — one row each, exactly what the storefront shows */}
      <Card padded={false} className="mb-5 overflow-hidden">
        <div className="px-5 pt-5 lg:px-6">
          <CardHeader
            title="Saved addresses"
            description={`${c.addresses.length} on the storefront · used to auto-fill checkout`}
            className="mb-3"
          />
        </div>
        <AddressBook
          parentId={c.id}
          initial={c.addresses.map((a) => ({
            id: a.id,
            label: a.label ?? null,
            addressType: a.addressType as "shipping" | "billing",
            receiverName: a.receiverName,
            receiverPhone: a.receiverPhone,
            line1: a.line1,
            line2: a.line2 ?? null,
            city: a.city,
            state: a.state,
            pincode: a.pincode,
            gstin: a.gstin ?? null,
            isDefault: a.isDefault,
          }))}
        />
      </Card>

      {/* Orders — full width so the columns breathe */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-5 pt-5 lg:px-6">
          <CardHeader
            title="Orders"
            description={c.totalOrderCount > c.orders.length ? `Latest ${c.orders.length} of ${c.totalOrderCount}` : `${c.orders.length} order${c.orders.length === 1 ? "" : "s"}`}
            className="mb-3"
            actions={
              c.orders.length > 0 ? (
                <Link href={`/admin/orders?q=${encodeURIComponent(c.phone)}`} className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-900">
                  Open in Orders →
                </Link>
              ) : null
            }
          />
        </div>

        {c.orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="When this customer places an order, it appears here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>Payment</Th>
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono font-semibold text-ink-900 transition-colors hover:text-brand-700"
                      >
                        {o.orderNumber}
                      </Link>
                    </Td>
                    <Td muted>{fmtDate(o.createdAt)}</Td>
                    <Td>
                      <Badge tone={statusTone(o.status)} dot size="sm">
                        {o.status}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(o.paymentStatus)} size="sm">
                        {o.paymentStatus}
                      </Badge>
                    </Td>
                    <Td right>
                      <Money paise={o.total} className="font-semibold" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5">
        <RecordHistory entityType="customer" entityId={id} title="Customer history" />
      </div>
    </div>
  );
}
