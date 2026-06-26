import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { concerns, concernMessages, orders } from "@/db/schema";
import { PageHeader, Card, Badge } from "@/components/admin/ui/primitives";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import { ConcernActions } from "@/components/admin/ConcernActions";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  payment: "Payment Issues",
  order_delivery: "Order & Delivery",
  customer_care: "Customer Care",
  student_details: "Student Details",
  login: "Website Login",
  size_exchange: "Size Exchange",
};
const STATUS_TONE = {
  open: "warning",
  in_progress: "info",
  resolved: "success",
  rejected: "danger",
} as const;

function fmt(d: Date) {
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function ConcernDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission(
    "contact-forms.read",
    "contact-forms.write",
    "returns.write",
    "orders.write",
  );
  if (isResponse(guard)) redirect("/admin/login");
  const { id } = await params;

  const [c] = await db.select().from(concerns).where(eq(concerns.id, id)).limit(1);
  if (!c) notFound();

  const [linkedOrder] = c.orderId
    ? await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, c.orderId)).limit(1)
    : [null as { orderNumber: string } | null];

  const msgs = await db
    .select()
    .from(concernMessages)
    .where(eq(concernMessages.concernId, id))
    .orderBy(asc(concernMessages.createdAt));

  return (
    <div className="space-y-6">
      <Link href="/admin/parent-concerns" className="text-[13px] font-medium text-ink-500 hover:text-ink-900">
        ← All concerns
      </Link>
      <PageHeader
        title={c.concernNumber ?? id.slice(0, 8)}
        description={CATEGORY_LABEL[c.category] ?? c.category}
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[15px] font-bold text-ink-900">Conversation</h3>
              <Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE] ?? "default"}>
                {c.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="mt-4 space-y-4">
              {msgs.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl p-3 ${
                    m.author === "agent"
                      ? "ml-8 bg-brand/5"
                      : m.author === "system"
                        ? "bg-cream-50 text-ink-500"
                        : "mr-8 bg-cream-100"
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    {m.author === "agent" ? "Support" : m.author === "system" ? "System" : m.authorName || "Parent"} · {fmt(m.createdAt)}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-800">{m.body}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="font-display text-[15px] font-bold text-ink-900">Details</h3>
            <dl className="mt-3 space-y-2 text-[13px]">
              <Row label="Parent" value={c.contactName} />
              <Row label="Mobile" value={c.contactPhone} />
              <Row label="Order" value={linkedOrder?.orderNumber ?? c.orderRef} />
              <Row label="Raised" value={fmt(c.createdAt)} />
              <Row label="Assigned to" value={c.assignedToName ?? "Unassigned"} />
            </dl>
          </Card>

          <Card className="p-5">
            <ConcernActions
              concernId={c.id}
              status={c.status}
              assignedToName={c.assignedToName}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-400">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value || "—"}</dd>
    </div>
  );
}
