import { desc, and, eq } from "drizzle-orm";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { db } from "@/db/client";
import { concerns } from "@/db/schema";
import { PageHeader, Card, Th, Td, Tr, EmptyState, Badge } from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

/**
 * Admin "Parent Concerns" module — the support team's queue for concerns
 * raised on the public Parent Help Portal (inventre.in/portal). List +
 * filter by category / status; click through to assign, reply, and update
 * status with full history.
 */

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  payment: "Payment",
  order_delivery: "Order & Delivery",
  customer_care: "Customer Care",
  student_details: "Student Details",
  login: "Website Login",
  size_exchange: "Size Exchange",
};
const STATUSES = ["open", "in_progress", "resolved", "rejected"] as const;
const CATEGORIES = Object.keys(CATEGORY_LABEL);

const STATUS_TONE = {
  open: "warning",
  in_progress: "info",
  resolved: "success",
  rejected: "danger",
} as const;

export default async function ParentConcernsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string }>;
}) {
  const guard = await requireAnyPermission(
    "contact-forms.read",
    "contact-forms.write",
    "returns.write",
    "orders.write",
  );
  if (isResponse(guard)) redirect("/admin/login");

  const sp = await searchParams;
  const filters = [];
  if (sp.category && CATEGORIES.includes(sp.category)) filters.push(eq(concerns.category, sp.category));
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) filters.push(eq(concerns.status, sp.status));

  const rows = await db
    .select({
      id: concerns.id,
      concernNumber: concerns.concernNumber,
      category: concerns.category,
      status: concerns.status,
      contactName: concerns.contactName,
      contactPhone: concerns.contactPhone,
      assignedToName: concerns.assignedToName,
      createdAt: concerns.createdAt,
    })
    .from(concerns)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(concerns.createdAt))
    .limit(200);

  const chip = (label: string, key: "category" | "status", value: string | null) => {
    const active = value === null ? !sp[key] : sp[key] === value;
    const qs = new URLSearchParams(sp as Record<string, string>);
    if (value === null) qs.delete(key);
    else qs.set(key, value);
    return (
      <Link
        key={`${key}:${value ?? "all"}`}
        href={`/admin/parent-concerns?${qs.toString()}`}
        className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
          active ? "bg-ink-900 text-white" : "bg-cream-100 text-ink-600 hover:bg-cream-200"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Parent Concerns" description="Concerns raised on the public help portal" />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">Category</span>
        {chip("All", "category", null)}
        {CATEGORIES.map((c) => chip(CATEGORY_LABEL[c], "category", c))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">Status</span>
        {chip("All", "status", null)}
        {STATUSES.map((s) => chip(s.replace(/_/g, " "), "status", s))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="No concerns" description="Nothing matches these filters yet." />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <Tr>
                <Th>Ticket</Th>
                <Th>Category</Th>
                <Th>Parent</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>Raised</Th>
              </Tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/parent-concerns/${r.id}`} className="font-semibold text-brand hover:underline">
                      {r.concernNumber ?? r.id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>{CATEGORY_LABEL[r.category] ?? r.category}</Td>
                  <Td>
                    {r.contactName ?? "—"}
                    <span className="block text-[11px] text-ink-400">{r.contactPhone ?? ""}</span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "default"}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td>{r.assignedToName ?? <span className="text-ink-400">Unassigned</span>}</Td>
                  <Td>{r.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
