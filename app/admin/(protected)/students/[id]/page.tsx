import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  students, studentAddresses, studentGuardianLinks,
  schools, grades, schoolGradeMappings, parents,
} from "@/db/schema";
import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { last10 } from "@/lib/phone";
import {
  PageHeader, Card, CardHeader, Badge, Th, Td, Tr, EmptyState,
} from "@/components/admin/ui/primitives";
import { StudentEditor, GuardianLinkEditor } from "@/components/admin/StudentEditor";
import { AddressEditor, SiblingStudentEditor } from "@/components/admin/ChildTableEditors";
import { RemoveFromFamilyButton } from "@/components/admin/RemoveFromFamilyButton";
import {
  erpSchemaReady, countStudentSalesOrders, loadStudentSalesOrders,
  type StudentSalesData, type ErpOrder, type ErpItem,
  type ErpShipment, type ErpPayment,
} from "@/lib/erp-sales";

export const dynamic = "force-dynamic";

type Tab = "details" | "addressContact" | "relations" | "salesOrders" | "dashboard";

function tabHref(id: string, t: Tab) { return `/admin/students/${id}?tab=${t}`; }

export default async function StudentDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { id } = await params;
  const { tab = "details" } = await searchParams;

  const [s] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!s) notFound();

  const [addrs, guardianLinks, schoolsList, gradesList, school, mappingRows, linkedChildren] = await Promise.all([
    db.select().from(studentAddresses).where(eq(studentAddresses.studentId, id)).orderBy(asc(studentAddresses.kind), asc(studentAddresses.rowIdx)),
    db.select().from(studentGuardianLinks).where(eq(studentGuardianLinks.studentId, id)).orderBy(asc(studentGuardianLinks.rowIdx)),
    db.select({ id: schools.id, code: schools.schoolCode, name: schools.schoolName }).from(schools).orderBy(asc(schools.schoolName)),
    db.select({ erpName: grades.erpName, gradeName: grades.gradeName }).from(grades).orderBy(asc(grades.gradeName)),
    s.schoolCode
      ? db.select({ id: schools.id, schoolName: schools.schoolName, schoolCode: schools.schoolCode }).from(schools).where(eq(schools.schoolCode, s.schoolCode)).limit(1)
      : Promise.resolve([] as { id: string; schoolName: string | null; schoolCode: string | null }[]),
    db.select({
      schoolId: schoolGradeMappings.schoolId,
      grade: schoolGradeMappings.grade,
      displayName: schoolGradeMappings.schoolGivenGradeName,
      sections: schoolGradeMappings.sections,
    }).from(schoolGradeMappings).orderBy(asc(schoolGradeMappings.rowIdx)),
    // Auto-detected siblings: every OTHER student under the same parent_id.
    // Populated by the guardian-link route when admin adds an existing
    // guardian's phone (which attaches the new student to that family's
    // parent_id). No DB writes here — the relationship is rendered live
    // from the canonical parent_id graph.
    s.parentId
      ? db
          .select({
            id: students.id,
            name: students.name,
            firstName: students.firstName,
            lastName: students.lastName,
            enrollmentNumber: students.enrollmentNumber,
            schoolCode: students.schoolCode,
            grade: students.grade,
            section: students.section,
            gender: students.gender,
            dateOfBirth: students.dateOfBirth,
            isVerified: students.isVerified,
          })
          .from(students)
          // Same filter as the storefront student-picker — disabled /
          // blocked siblings (e.g. Removed-from-family) must not count
          // toward the "Relations (N)" tab label or render in the
          // siblings table.
          .where(
            and(
              eq(students.parentId, s.parentId),
              eq(students.enabled, true),
              eq(students.status, "active"),
            )
          )
          .orderBy(asc(students.enrollmentNumber))
      : Promise.resolve([] as Array<{ id: string; name: string; firstName: string | null; lastName: string | null; enrollmentNumber: string | null; schoolCode: string | null; grade: string | null; section: string | null; gender: string | null; dateOfBirth: string | null; isVerified: boolean }>),
  ]);
  // Drop self from linkedChildren — the SQL filter is "same parent_id",
  // which trivially includes the current student.
  const otherChildren = linkedChildren.filter((c) => c.id !== id);

  // Per-school grade+section catalog so the dropdowns can react to the
  // selected school. See the new-student page for the same shape.
  const idToCode = new Map(schoolsList.map((x) => [x.id, x.code]));
  const gradesBySchool: Record<
    string,
    { grade: string; displayName: string | null; sections: string | null }[]
  > = {};
  for (const m of mappingRows) {
    if (!m.grade) continue;
    const code = idToCode.get(m.schoolId);
    if (!code) continue;
    (gradesBySchool[code] ??= []).push({
      grade: m.grade,
      displayName: m.displayName,
      sections: m.sections,
    });
  }

  const billing = addrs.filter((a) => a.kind === "billing");
  const shipping = addrs.filter((a) => a.kind === "shipping");

  // Parent row (when present) and MCB access metadata. These come from
  // separate tables that grantMcbAccess writes — parents via
  // students.parentId, mcb_students by enrolment_number.
  const parentRow = s.parentId
    ? (
        await db
          .select({ id: parents.id, name: parents.name, phone: parents.phone, email: parents.email })
          .from(parents)
          .where(eq(parents.id, s.parentId))
          .limit(1)
      )[0] ?? null
    : null;
  const parentPhoneStatus: "ready" | "pending" | "invalid" = (() => {
    if (!parentRow?.phone) return "invalid";
    const n = last10(parentRow.phone);
    return n ? "ready" : "invalid";
  })();
  const mcbAccessRows = s.enrollmentNumber
    ? ((await db.execute(sql`
        SELECT website_access, website_access_at, website_access_by
          FROM mcb_students
         WHERE enrolment_number = ${s.enrollmentNumber}
         LIMIT 1
      `)) as unknown as {
        website_access: boolean | null;
        website_access_at: string | null;
        website_access_by: string | null;
      }[])
    : [];
  const mcbAccess = mcbAccessRows[0] ?? null;
  const mcbAccessGranted = !!mcbAccess?.website_access;

  // Per-guardian-link login status: green=parent row exists for this phone,
  // amber=valid 10-digit but no parent row yet (verify will auto-create on
  // first OTP), red=phone can't be normalized to 10 digits.
  const normalizedPhones = Array.from(
    new Set(
      guardianLinks
        .map((g) => last10(g.phoneNo))
        .filter((p): p is string => p !== null),
    ),
  );
  const knownParentPhones = normalizedPhones.length
    ? new Set(
        (
          await db
            .select({ phone: parents.phone })
            .from(parents)
            .where(inArray(parents.phone, normalizedPhones))
        ).map((r) => r.phone),
      )
    : new Set<string>();
  const guardianLoginStatus = new Map<string, "ready" | "pending" | "invalid">();
  for (const g of guardianLinks) {
    const n = last10(g.phoneNo);
    if (!n) guardianLoginStatus.set(g.id, "invalid");
    else if (knownParentPhones.has(n)) guardianLoginStatus.set(g.id, "ready");
    else guardianLoginStatus.set(g.id, "pending");
  }

  // ── ERP sales orders (read-only mirror in the `erp` schema) ──────────
  const studentKey = {
    enrollmentNumber: s.enrollmentNumber,
    schoolCode: s.schoolCode,
    customerLink: s.customerLink,
  };
  const erpReady = await erpSchemaReady();
  const salesOrderCount = erpReady
    ? await countStudentSalesOrders(studentKey)
    : 0;
  const salesData: StudentSalesData | null =
    erpReady && tab === "salesOrders"
      ? await loadStudentSalesOrders(studentKey)
      : null;

  return (
    <div className="max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "Students", href: "/admin/students" },
          { label: [s.firstName, s.lastName].filter(Boolean).join(" ") || s.erpName || "Student" },
        ]}
        eyebrow="Student"
        title={[s.firstName, s.lastName].filter(Boolean).join(" ") || s.erpName || "Student"}
        description={
          <span className="flex items-center gap-2 flex-wrap">
            <Badge tone={s.enabled ? "success" : "default"} dot size="sm">{s.enabled ? "Enabled" : "Disabled"}</Badge>
            {s.grade ? <Badge tone="brand" size="sm">{s.grade}</Badge> : null}
            {s.isVerified ? <Badge tone="info" size="sm">Verified</Badge> : null}
            {s.isNewStudent ? <Badge tone="warning" size="sm">New</Badge> : null}
            {mcbAccessGranted ? (
              <Badge tone="success" size="sm" title={
                `Access granted${mcbAccess?.website_access_at ? ` on ${new Date(mcbAccess.website_access_at).toLocaleDateString("en-IN")}` : ""}${mcbAccess?.website_access_by ? ` by ${mcbAccess.website_access_by}` : ""}`
              }>MCB Access</Badge>
            ) : null}
            {school[0] ? (
              <Link href={`/admin/schools/${school[0].id}`} className="text-[11px] text-brand-700 hover:underline">{school[0].schoolName ?? school[0].schoolCode}</Link>
            ) : null}
          </span>
        }
      />

      <div className="flex items-center gap-1 mb-5 border-b border-ink-100/70 overflow-x-auto">
        {[
          { id: "details" as const, label: "Details" },
          { id: "addressContact" as const, label: `Address & Contact (${addrs.length})` },
          { id: "relations" as const, label: (() => {
              // Spell out the breakdown so the count never reads as a
              // single number that the admin has to mentally split into
              // guardians + siblings (which caused the recurring
              // "Relations (2) but only 1 row" confusion).
              const g = guardianLinks.length;
              const sib = otherChildren.length;
              const parts: string[] = [];
              parts.push(`${g} guardian${g === 1 ? "" : "s"}`);
              parts.push(`${sib} sibling${sib === 1 ? "" : "s"}`);
              return `Relations (${parts.join(" · ")})`;
            })() },
          { id: "salesOrders" as const, label: `Sales Orders (${salesOrderCount})` },
          { id: "dashboard" as const, label: "Dashboard" },
        ].map((t) => (
          <Link key={t.id} href={tabHref(id, t.id)}
            className={`px-3 py-2 text-[13px] -mb-px border-b-2 whitespace-nowrap ${tab === t.id ? "border-brand-600 text-ink-900 font-semibold" : "border-transparent text-ink-500 hover:text-ink-800"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "details" && (
        <div className="space-y-5">
        {(parentRow || mcbAccessGranted) && (
          <Card>
            <CardHeader
              title="Parent &amp; access"
              description={
                mcbAccessGranted
                  ? `Granted via MCB${mcbAccess?.website_access_at ? ` on ${new Date(mcbAccess.website_access_at).toLocaleDateString("en-IN")}` : ""}${mcbAccess?.website_access_by ? ` by ${mcbAccess.website_access_by}` : ""}.`
                  : "Linked parent — created at student grant time."
              }
            />
            <div className="px-5 pb-5 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-400">Parent name</p>
                <p className="text-ink-900">{parentRow?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-400">Parent phone</p>
                <p className="text-ink-900 flex items-center gap-2">
                  {parentRow?.phone ?? "—"}
                  {parentRow?.phone ? (
                    parentPhoneStatus === "ready" ? (
                      <Badge tone="success" size="sm">Login ready</Badge>
                    ) : (
                      <Badge tone="warning" size="sm">Invalid</Badge>
                    )
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-400">Parent email</p>
                <p className="text-ink-900">{parentRow?.email ?? "—"}</p>
              </div>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Student details" description="All fields are editable. Guardians & siblings live on the Relations tab; addresses on Address & Contact." />
          <StudentEditor
            mode="edit"
            studentId={id}
            schoolCodes={schoolsList.filter((x) => x.code).map((x) => ({ code: x.code!, name: x.name }))}
            gradeOptions={gradesList.map((g) => g.erpName ?? g.gradeName ?? "").filter(Boolean)}
            gradesBySchool={gradesBySchool}
            initial={{
              enabled: s.enabled, isNewStudent: s.isNewStudent, isVerified: s.isVerified,
              schoolCode: s.schoolCode ?? "",
              enrollmentNumber: s.enrollmentNumber ?? "",
              firstName: s.firstName ?? "",
              middleName: s.middleName ?? "",
              lastName: s.lastName ?? "",
              grade: s.grade ?? "",
              section: s.section ?? "",
              joiningDate: s.joiningDate ?? "",
              houseColor: s.houseColor ?? "",
              medium: s.medium ?? "",
              curriculum: s.curriculum ?? "",
              shoeSize: s.shoeSize ?? "",
              shirtSize: s.shirtSize ?? "",
              trouserSize: s.trouserSize ?? "",
              studentEmailId: s.studentEmailId ?? "",
              studentMobileNumber: s.studentMobileNumber ?? "",
              dateOfBirth: s.dateOfBirth ?? "",
              bloodGroup: s.bloodGroup ?? "",
              gender: s.gender ?? "Male",
              nationality: s.nationality ?? "Indian",
            }}
          />
        </Card>
        </div>
      )}

      {tab === "addressContact" && (
        <div className="space-y-5">
          <Card>
            <CardHeader title={`Billing addresses (${billing.length})`} description="Add or remove billing addresses. Used for invoices and tax compliance." />
            <AddressEditor studentId={id} kind="billing" initial={billing.map((a) => ({ id: a.id, rowIdx: a.rowIdx, kind: "billing" as const, addressType: a.addressType, addressTitle: a.addressTitle, addressLine1: a.addressLine1, addressLine2: a.addressLine2, city: a.city, state: a.state, country: a.country, pincode: a.pincode, preferred: a.preferred, disabled: a.disabled }))} />
          </Card>
          <Card>
            <CardHeader title={`Shipping addresses (${shipping.length})`} description="Used for delivery. The Magic Box is shipped here." />
            <AddressEditor studentId={id} kind="shipping" initial={shipping.map((a) => ({ id: a.id, rowIdx: a.rowIdx, kind: "shipping" as const, addressType: a.addressType, addressTitle: a.addressTitle, addressLine1: a.addressLine1, addressLine2: a.addressLine2, city: a.city, state: a.state, country: a.country, pincode: a.pincode, preferred: a.preferred, disabled: a.disabled }))} />
          </Card>
        </div>
      )}

      {tab === "relations" && (
        <div className="space-y-5">
          <Card>
            <CardHeader title={`Guardians (${guardianLinks.length})`} description="Add a guardian row to link this student to a parent or guardian. Click the trash icon to remove a link." />
            <GuardianLinkEditor studentId={id} initial={guardianLinks.map((g) => ({ id: g.id, rowIdx: g.rowIdx, guardianErpName: g.guardianErpName, guardianName: g.guardianName, relation: g.relation, email: g.email, phoneNo: g.phoneNo, knownErpNames: g.knownErpNames, loginStatus: guardianLoginStatus.get(g.id) ?? "invalid" }))} />
          </Card>

          <Card>
            <CardHeader
              title={`Siblings (${otherChildren.length})`}
              description="Other students sharing this family. Adding a sibling here creates a new student under the same parent account and copies the guardian list across — both students sign in via the same guardian phones."
            />
            <SiblingStudentEditor
              studentId={id}
              defaultSchoolCode={s.schoolCode ?? null}
              siblings={otherChildren}
              schoolCodes={schoolsList.filter((x) => x.code).map((x) => ({ code: x.code!, name: x.name }))}
              gradesBySchool={gradesBySchool}
            />
          </Card>

          {/* Destructive: detach this student from the family entirely.
              Hidden when the student already has no parent_id (nothing
              to unlink). Used when phone-based dedup correctly resolved
              the student to a family but the student doesn't actually
              belong (e.g. legacy MCB row pulled in by the phone
              backfill). Order/cart history is preserved. */}
          {s.parentId ? (
            <Card>
              <CardHeader
                title="Remove from family"
                description="Disables this student and detaches it from the parent. Use when the dedup wrongly attached this record to a family. Order history is preserved."
              />
              <div className="px-5 pb-5">
                <RemoveFromFamilyButton studentId={id} />
              </div>
            </Card>
          ) : null}
        </div>
      )}

      {tab === "salesOrders" && (
        <div className="space-y-5">
          {!erpReady ? (
            <Card>
              <EmptyState title="ERP data not loaded" description="The erp.sales_orders mirror is not present in this database." />
            </Card>
          ) : !salesData || salesData.orders.length === 0 ? (
            <Card>
              <CardHeader title="Sales orders" description={
                salesData && salesData.customerNames.length
                  ? `Resolved ERP customer(s): ${salesData.customerNames.join(", ")} — but no sales orders found.`
                  : "Could not map this student to an ERP customer (no enrollment/customer-link match)."
              } />
              <EmptyState title="No sales orders" description="Nothing in the ERP mirror for this student." />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader
                  title={`Sales orders (${salesData.totals.orderCount})`}
                  description={`ERP customer: ${salesData.customerNames.join(", ")} · Lifetime order value ₹${salesData.totals.lifetimeValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                />
              </Card>
              {salesData.orders.map((o) => (
                <SalesOrderCard
                  key={o.order_no}
                  order={o}
                  items={salesData.itemsByOrder.get(o.order_no) ?? []}
                  shipments={salesData.shipmentsByOrder.get(o.order_no) ?? []}
                  payments={salesData.paymentsByOrder.get(o.order_no) ?? []}
                />
              ))}
            </>
          )}
        </div>
      )}

      {tab === "dashboard" && (
        <Card>
          <CardHeader title="Student dashboard" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <Stat label="Guardians" value={guardianLinks.length} />
            <Stat label="Siblings" value={otherChildren.length} />
            <Stat label="Addresses" value={addrs.length} />
            <Stat label="Last updated" value={s.syncedAt ? new Date(s.syncedAt).toLocaleString() : "—"} />
          </div>
        </Card>
      )}
    </div>
  );
}

function AddressTable({ addrs }: { addrs: Array<{ id: string; rowIdx: number; addressType: string | null; addressTitle: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; country: string | null; pincode: string | null; preferred: boolean; disabled: boolean }> }) {
  if (addrs.length === 0) return <EmptyState title="No addresses" description="No address rows yet." />;
  return (
    <table className="w-full text-[13px]">
      <thead><tr><Th>No.</Th><Th>Type</Th><Th>Title</Th><Th>Line 1</Th><Th>City</Th><Th>State</Th><Th>Country</Th><Th>Pincode</Th><Th>Flags</Th></tr></thead>
      <tbody>{addrs.map((a) => (
        <Tr key={a.id}>
          <Td muted>{a.rowIdx}</Td>
          <Td>{a.addressType ?? "—"}</Td>
          <Td muted>{a.addressTitle ?? "—"}</Td>
          <Td>{[a.addressLine1, a.addressLine2].filter(Boolean).join(", ") || "—"}</Td>
          <Td muted>{a.city ?? "—"}</Td>
          <Td muted>{a.state ?? "—"}</Td>
          <Td muted>{a.country ?? "—"}</Td>
          <Td muted><span className="font-mono text-[12px]">{a.pincode ?? "—"}</span></Td>
          <Td>{a.preferred ? <Badge tone="info" size="sm">Preferred</Badge> : null}{a.disabled ? <Badge tone="default" size="sm">Disabled</Badge> : null}</Td>
        </Tr>
      ))}</tbody>
    </table>
  );
}

function money(n: number | null | undefined) {
  if (n == null) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function payTone(s: string | null): "success" | "warning" | "danger" | "default" {
  const x = (s ?? "").toUpperCase();
  if (x === "SUCCESS" || x === "PAID") return "success";
  if (x === "PARTIAL" || x === "PENDING") return "warning";
  if (x === "FAILED" || x === "CANCELLED") return "danger";
  return "default";
}

function SalesOrderCard({
  order, items, shipments, payments,
}: {
  order: ErpOrder;
  items: ErpItem[];
  shipments: ErpShipment[];
  payments: ErpPayment[];
}) {
  const outstanding = payments.reduce((s, p) => s + (p.outstanding ?? 0), 0);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px]">{order.order_no}</span>
            <Badge tone="subtle" size="sm">{order.status ?? "—"}</Badge>
            <Badge tone={payTone(order.payment_status)} size="sm">
              {order.payment_status ?? "—"}{order.payment_mode ? ` · ${order.payment_mode}` : ""}
            </Badge>
          </span>
        }
        description={
          `${order.transaction_date ?? "—"}` +
          (order.grade ? ` · ${order.grade}` : "") +
          (order.school ? ` · ${order.school}` : "") +
          ` · Total ${money(order.grand_total)}` +
          (outstanding > 0 ? ` · Outstanding ${money(outstanding)}` : "")
        }
      />

      <div className="text-[12px] font-semibold text-ink-500 mb-1.5 mt-1">Items</div>
      {items.length === 0 ? (
        <EmptyState title="No line items" description="No items recorded for this order." />
      ) : (
        <table className="w-full text-[13px] mb-4">
          <thead><tr><Th>Item</Th><Th>Code</Th><Th>Qty</Th><Th>Rate</Th><Th>Amount</Th><Th>Delivered</Th><Th>Returned</Th></tr></thead>
          <tbody>{items.map((it, i) => (
            <Tr key={order.order_no + "-i-" + i}>
              <Td>{it.item_name ?? "—"}</Td>
              <Td muted><span className="font-mono text-[12px]">{it.item_code ?? "—"}</span></Td>
              <Td muted>{it.qty ?? "—"}</Td>
              <Td muted>{money(it.rate)}</Td>
              <Td>{money(it.amount)}</Td>
              <Td muted>{it.delivered_qty ?? 0}</Td>
              <Td muted>{it.returned_qty ? <Badge tone="warning" size="sm">{it.returned_qty}</Badge> : "0"}</Td>
            </Tr>
          ))}</tbody>
        </table>
      )}

      <div className="text-[12px] font-semibold text-ink-500 mb-1.5">Tracking / shipments</div>
      {shipments.length === 0 ? (
        <p className="text-[13px] text-ink-500 mb-4">No shipment records.</p>
      ) : (
        <table className="w-full text-[13px] mb-4">
          <thead><tr><Th>Courier</Th><Th>Tracking #</Th><Th>Status</Th><Th>Dispatched</Th><Th>Delivered</Th><Th>To</Th></tr></thead>
          <tbody>{shipments.map((sh, i) => (
            <Tr key={order.order_no + "-s-" + i}>
              <Td>{sh.partner ?? "—"}</Td>
              <Td muted><span className="font-mono text-[12px]">{sh.tracking_number ?? "—"}</span></Td>
              <Td><Badge tone={sh.status === "delivered" ? "success" : "info"} size="sm">{sh.status ?? "—"}</Badge></Td>
              <Td muted>{sh.dispatched_at ?? "—"}</Td>
              <Td muted>{sh.delivered_at ?? "—"}</Td>
              <Td muted>{[sh.city, sh.pincode].filter(Boolean).join(" ") || "—"}</Td>
            </Tr>
          ))}</tbody>
        </table>
      )}

      <div className="text-[12px] font-semibold text-ink-500 mb-1.5">Payment schedule</div>
      {payments.length === 0 ? (
        <p className="text-[13px] text-ink-500">No payment schedule.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead><tr><Th>Due date</Th><Th>Amount</Th><Th>Paid</Th><Th>Outstanding</Th></tr></thead>
          <tbody>{payments.map((p, i) => (
            <Tr key={order.order_no + "-p-" + i}>
              <Td muted>{p.due_date ?? "—"}</Td>
              <Td>{money(p.payment_amount)}</Td>
              <Td muted>{money(p.paid_amount)}</Td>
              <Td>{(p.outstanding ?? 0) > 0 ? <Badge tone="danger" size="sm">{money(p.outstanding)}</Badge> : money(p.outstanding)}</Td>
            </Tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-4 rounded-xl bg-cream-50/50 border border-ink-100/70">
      <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}
