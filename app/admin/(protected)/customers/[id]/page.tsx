import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, Mail, GraduationCap, Edit2 } from "lucide-react";
import { getCustomerDetail } from "@/lib/repos/customers";
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
  Button,
  SectionTitle,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await getCustomerDetail(id);
  if (!c) notFound();

  const initials = (c.name ?? c.phone).slice(0, 2).toUpperCase();

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Customers", href: "/admin/customers" },
          { label: c.name ?? c.phone },
        ]}
        title={c.name ?? c.phone}
        description={
          <span className="flex items-center gap-3 mt-1 text-[13px]">
            <span className="inline-flex items-center gap-1 text-ink-700 font-medium">
              <Phone className="h-3.5 w-3.5" /> {c.phone}
            </span>
            {c.email ? (
              <span className="inline-flex items-center gap-1 text-ink-700 font-medium">
                <Mail className="h-3.5 w-3.5" /> {c.email}
              </span>
            ) : null}
            <Badge tone={c.status === "active" ? "success" : "danger"} dot size="sm">
              {c.status}
            </Badge>
          </span>
        }
        actions={
          <Link href={`/admin/customers/${c.id}/edit`}>
            <Button variant="secondary" icon={<Edit2 className="h-3.5 w-3.5" />}>
              Edit
            </Button>
          </Link>
        }
      />

      {/* Vitals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <Stat label="Lifetime value" value={<Money paise={c.totalLifetimeValue} />} iconTone="success" />
        <Stat label="Orders" value={c.totalOrderCount} iconTone="brand" />
        <Stat
          label="Last order"
          value={
            c.lastOrderAt ? (
              <span className="text-[18px] font-bold">
                {new Date(c.lastOrderAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            ) : (
              <span className="text-ink-400 text-[18px]">—</span>
            )
          }
        />
        <Stat
          label="Customer since"
          value={
            <span className="text-[18px] font-bold">
              {new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Students + Addresses (left column) */}
        <div className="lg:col-span-1 space-y-5">
          <Card>
            <CardHeader title="Students" description={`${c.students.length} linked`} />
            {c.students.length === 0 ? (
              <p className="text-[13px] text-ink-500">No students attached.</p>
            ) : (
              <ul className="space-y-2.5">
                {c.students.map((s) => (
                  <li key={s.id} className="flex items-start gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700">
                      <GraduationCap className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[13px] text-ink-900">{s.name}</div>
                      <div className="text-[11px] text-ink-500">
                        {s.schoolName} · {s.class ?? "?"}
                        {s.section ? ` ${s.section}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Addresses"
              description={`${c.addresses.length} on file · billing & shipping`}
            />
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
        </div>

        {/* Orders (right column, wider) */}
        <Card padded={false} className="lg:col-span-2">
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader title="Recent orders" description={`Last ${c.orders.length} of ${c.totalOrderCount}`} />
          </div>

          {c.orders.length === 0 ? (
            <EmptyState
              title="No orders yet"
              description="When this customer places an order, it appears here."
            />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th>Payment</Th>
                  <Th right>Total</Th>
                  <Th right>Date</Th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono font-semibold text-ink-900 hover:text-brand-700 transition-colors"
                      >
                        {o.orderNumber}
                      </Link>
                    </Td>
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
                    <Td right muted>
                      {new Date(o.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-5">
        <RecordHistory entityType="customer" entityId={id} title="Customer history" />
      </div>
    </div>
  );
}
