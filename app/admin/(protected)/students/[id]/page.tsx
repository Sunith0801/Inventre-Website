import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  students, studentAddresses, studentGuardianLinks,
  schools, grades, schoolGradeMappings, parents, addresses,
} from "@/db/schema";
import { eq, asc, desc, inArray, sql } from "drizzle-orm";
import { BadgeCheck, MapPin } from "lucide-react";
import { last10 } from "@/lib/phone";
import {
  PageHeader, Card, CardHeader, Badge, Th, Td, Tr, EmptyState, Stat,
} from "@/components/admin/ui/primitives";
import { Tabs } from "@/components/admin/ui/tabs";
import { StudentEditor, GuardianLinkEditor } from "@/components/admin/StudentEditor";
import { SiblingStudentEditor } from "@/components/admin/ChildTableEditors";
import { RemoveFromFamilyButton } from "@/components/admin/RemoveFromFamilyButton";
import { RecordHistory } from "@/components/admin/RecordHistory";
import {
  erpSchemaReady, countStudentSalesOrders, loadStudentSalesOrders,
  type StudentSalesData, type ErpOrder, type ErpItem,
  type ErpShipment, type ErpPayment,
} from "@/server/erp-sales";

export const dynamic = "force-dynamic";

type Tab = "details" | "addressContact" | "relations" | "salesOrders" | "dashboard";

const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
});
const IST_DATETIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const fmtDate = (d: Date | string | null | undefined) => (d ? IST_DATE.format(new Date(d)) : "—");
const fmtDateTime = (d: Date | string | null | undefined) => (d ? IST_DATETIME.format(new Date(d)) : "—");

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

  const [addrs, guardianLinks, schoolsList, gradesList, school, mappingRows, linkedChildren, savedAddresses] = await Promise.all([
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
    // Auto-detected siblings: every OTHER ACTIVE student sharing this
    // family's guardian-phone graph. We expand transitively from THIS
    // student's own guardian phones so split-parents-row cases (the same
    // family ended up with 2+ `parents` rows when different guardians
    // logged in first) still surface every sibling.
    //
    // Strict `parent_id =` is insufficient: e.g. 24BP1238 carries
    // [9502926367, 9063039470, 8639765107] and 25BP0935 only [9063039470].
    // They're siblings via the bridge phone 9063039470, but they live on
    // two `parents` rows; the parent_id-only query showed each one zero
    // siblings. Mirrors `getCurrentParent()` in lib/session.ts.
    db.execute(sql`
      WITH RECURSIVE family_phones AS (
        SELECT right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) AS p, 0 AS depth
          FROM student_guardian_links gl
         WHERE gl.student_id = ${id}
        UNION
        SELECT DISTINCT right(regexp_replace(coalesce(gl2.phone_no, ''), '\D', '', 'g'), 10), fp.depth + 1
          FROM family_phones fp
          JOIN student_guardian_links gl1
            ON right(regexp_replace(coalesce(gl1.phone_no, ''), '\D', '', 'g'), 10) = fp.p
          JOIN student_guardian_links gl2 ON gl2.student_id = gl1.student_id
         WHERE fp.depth < 4
      )
      SELECT s.id, s.name, s.first_name AS "firstName", s.last_name AS "lastName",
             s.enrollment_number AS "enrollmentNumber", s.school_code AS "schoolCode",
             s.grade, s.section, s.gender, s.date_of_birth AS "dateOfBirth",
             s.is_verified AS "isVerified"
        FROM students s
       WHERE s.enabled = true
         AND s.status  = 'active'
         AND (
           (${s.parentId ?? null}::uuid IS NOT NULL AND s.parent_id = ${s.parentId ?? null}::uuid)
           OR EXISTS (
             SELECT 1 FROM student_guardian_links gl
              WHERE gl.student_id = s.id
                AND right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10)
                    IN (SELECT p FROM family_phones)
           )
         )
       ORDER BY s.enrollment_number ASC NULLS LAST, s.id ASC
    `) as unknown as Promise<Array<{
      id: string;
      name: string;
      firstName: string | null;
      lastName: string | null;
      enrollmentNumber: string | null;
      schoolCode: string | null;
      grade: string | null;
      section: string | null;
      gender: string | null;
      dateOfBirth: string | null;
      isVerified: boolean;
    }>>,
    // The addresses the parent saved on the storefront (checkout / My
    // account). They arrive here automatically — nothing to type in.
    s.parentId
      ? db.select().from(addresses).where(eq(addresses.parentId, s.parentId)).orderBy(desc(addresses.isDefault), desc(addresses.createdAt))
      : Promise.resolve([] as (typeof addresses.$inferSelect)[]),
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

  // Parent row (when present) and MCB access metadata. These come from
  // separate tables that grantMcbAccess writes — parents via
  // students.parentId, mcb_students by enrolment_number.
  const parentRow = s.parentId
    ? (
        await db
          .select({ id: parents.id, name: parents.name, phone: parents.phone, email: parents.email, lastLoginAt: parents.lastLoginAt })
          .from(parents)
          .where(eq(parents.id, s.parentId))
          .limit(1)
      )[0] ?? null
    : null;
  const parentPhoneStatus: "ready" | "invalid" = parentRow?.phone && last10(parentRow.phone) ? "ready" : "invalid";
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
  const salesOrderCount = erpReady ? await countStudentSalesOrders(studentKey) : 0;
  const salesData: StudentSalesData | null =
    erpReady && tab === "salesOrders" ? await loadStudentSalesOrders(studentKey) : null;

  const fullName = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.erpName || "Student";
  const displayGrade = gradesBySchool[s.schoolCode ?? ""]?.find((g) => g.grade === s.grade)?.displayName ?? s.grade;

  const TABS = [
    { key: "details", label: "Details" },
    { key: "addressContact", label: `Addresses (${savedAddresses.length + addrs.length})` },
    { key: "relations", label: `Family (${guardianLinks.length} guardian${guardianLinks.length === 1 ? "" : "s"} · ${otherChildren.length} sibling${otherChildren.length === 1 ? "" : "s"})` },
    { key: "salesOrders", label: `Sales orders (${salesOrderCount})` },
    { key: "dashboard", label: "Overview" },
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        breadcrumb={[{ label: "Students", href: "/admin/students" }, { label: fullName }]}
        title={fullName}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {s.enrollmentNumber ? <span className="font-mono text-[12.5px] text-ink-600">{s.enrollmentNumber}</span> : null}
            {school[0] ? (
              <>
                <span className="text-ink-300">·</span>
                <span className="text-[12.5px] text-ink-600">{school[0].schoolName ?? school[0].schoolCode}</span>
              </>
            ) : null}
            {displayGrade ? (
              <>
                <span className="text-ink-300">·</span>
                <span className="text-[12.5px] text-ink-600">{displayGrade}{s.section ? ` · ${s.section}` : ""}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.enabled ? "success" : "default"} dot>{s.enabled ? "Website access on" : "Access off"}</Badge>
            {s.isNewStudent ? <Badge tone="warning">New student</Badge> : null}
            {s.isVerified ? (
              <Badge tone="info" title={s.verifiedAt ? `Verified by the parent on ${fmtDateTime(s.verifiedAt)}` : "Verified by the parent"}>
                <BadgeCheck className="h-3.5 w-3.5" /> Verified
              </Badge>
            ) : (
              <Badge tone="subtle">Not verified</Badge>
            )}
            {mcbAccessGranted ? <Badge tone="success">MCB access</Badge> : null}
          </span>
        }
      />

      <Tabs tabs={TABS} active={tab} hrefFor={(key) => `/admin/students/${id}?tab=${key}`} className="mb-5" />

      {tab === "details" && (
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Parent & sign-in"
              description={
                mcbAccessGranted
                  ? `Access granted via MCB${mcbAccess?.website_access_at ? ` on ${fmtDate(mcbAccess.website_access_at)}` : ""}${mcbAccess?.website_access_by ? ` by ${mcbAccess.website_access_by}` : ""}.`
                  : parentRow
                    ? "The parent account this student is attached to."
                    : "No parent account is linked yet — add a guardian under Family."
              }
            />
            {parentRow ? (
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Parent">{parentRow.name ?? "—"}</Fact>
                <Fact label="Mobile">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">{parentRow.phone ?? "—"}</span>
                    {parentRow.phone ? (
                      parentPhoneStatus === "ready" ? <Badge tone="success" size="sm">Login ready</Badge> : <Badge tone="warning" size="sm">Invalid</Badge>
                    ) : null}
                  </span>
                </Fact>
                <Fact label="Email">{parentRow.email ?? "—"}</Fact>
                <Fact label="Last sign-in">{parentRow.lastLoginAt ? fmtDateTime(parentRow.lastLoginAt) : "Never"}</Fact>
                <Fact label="Verified">
                  {s.isVerified ? (
                    <span className="inline-flex items-center gap-1.5 text-sky-700">
                      <BadgeCheck className="h-4 w-4" /> {s.verifiedAt ? fmtDateTime(s.verifiedAt) : "Yes"}
                    </span>
                  ) : (
                    <span className="text-ink-500">Not yet — the parent confirms this on their first sign-in</span>
                  )}
                </Fact>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Student details" description="Identity, class and personal details. Website access and the new-student flag are here too." />
            <StudentEditor
              mode="edit"
              studentId={id}
              schoolCodes={schoolsList.filter((x) => x.code).map((x) => ({ code: x.code!, name: x.name }))}
              gradeOptions={gradesList.map((g) => g.erpName ?? g.gradeName ?? "").filter(Boolean)}
              gradesBySchool={gradesBySchool}
              initial={{
                enabled: s.enabled, isNewStudent: s.isNewStudent,
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
        <Card padded={false}>
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader
              title={`Addresses (${savedAddresses.length + addrs.length})`}
              description={
                parentRow
                  ? "Filled in automatically from what the parent saved on the website at checkout or under My account. Rows from ERPNext are marked."
                  : "No parent account is linked yet, so nothing has come in from the website."
              }
            />
          </div>
          {savedAddresses.length + addrs.length === 0 ? (
            <EmptyState icon={MapPin} title="No addresses yet" description="They appear here as soon as the parent saves a delivery address on the website." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Receiver</Th>
                    <Th>Phone</Th>
                    <Th>Address</Th>
                    <Th>City</Th>
                    <Th>State</Th>
                    <Th>Pincode</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {savedAddresses.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="capitalize">{a.label || a.addressTitle || a.addressType}</span>
                          {a.isDefault ? <Badge tone="brand" size="sm">Default</Badge> : null}
                        </span>
                      </Td>
                      <Td>{a.receiverName}</Td>
                      <Td muted><span className="font-mono">{a.receiverPhone}</span></Td>
                      <Td muted>
                        <span className="block max-w-[360px] whitespace-normal leading-snug">
                          {[a.line1, a.line2, a.landmark ? `Near ${a.landmark}` : null].filter(Boolean).join(", ")}
                        </span>
                      </Td>
                      <Td muted>{a.city}</Td>
                      <Td muted>{a.state}</Td>
                      <Td muted><span className="font-mono">{a.pincode}</span></Td>
                      <Td><Badge tone="success" size="sm">Website</Badge></Td>
                    </Tr>
                  ))}
                  {addrs.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="capitalize">{a.addressTitle || a.addressType || a.kind}</span>
                          {a.preferred ? <Badge tone="brand" size="sm">Preferred</Badge> : null}
                          {a.disabled ? <Badge tone="default" size="sm">Disabled</Badge> : null}
                        </span>
                      </Td>
                      <Td muted><span className="text-ink-300">—</span></Td>
                      <Td muted><span className="text-ink-300">—</span></Td>
                      <Td muted>
                        <span className="block max-w-[360px] whitespace-normal leading-snug">
                          {[a.addressLine1, a.addressLine2].filter(Boolean).join(", ") || "—"}
                        </span>
                      </Td>
                      <Td muted>{a.city ?? "—"}</Td>
                      <Td muted>{a.state ?? "—"}</Td>
                      <Td muted><span className="font-mono">{a.pincode ?? "—"}</span></Td>
                      <Td><Badge tone="subtle" size="sm">ERPNext · {a.kind}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "relations" && (
        <div className="space-y-5">
          <Card>
            <CardHeader title={`Guardians (${guardianLinks.length})`} description="Each 10-digit mobile here can sign in for this student." />
            <GuardianLinkEditor studentId={id} initial={guardianLinks.map((g) => ({ id: g.id, rowIdx: g.rowIdx, guardianErpName: g.guardianErpName, guardianName: g.guardianName, relation: g.relation, email: g.email, phoneNo: g.phoneNo, knownErpNames: g.knownErpNames, loginStatus: guardianLoginStatus.get(g.id) ?? "invalid" }))} />
          </Card>

          <Card>
            <CardHeader title={`Siblings (${otherChildren.length})`} description="Other students who share a guardian mobile with this one." />
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
              to unlink). Order/cart history is preserved. */}
          {s.parentId ? (
            <Card className="border-red-200/80">
              <CardHeader
                title={<span className="text-red-800">Remove from family</span>}
                description="For a student that was pulled into the wrong family by a shared mobile number. The parent loses access to this student; orders and history are kept."
                actions={
                  <RemoveFromFamilyButton
                    studentId={id}
                    studentName={fullName}
                    parentLabel={parentRow ? [parentRow.name, parentRow.phone].filter(Boolean).join(" · ") : null}
                  />
                }
              />
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Stat label="Orders" value={salesData.totals.orderCount.toLocaleString("en-IN")} iconTone="brand" />
                <Stat label="Lifetime value" value={`₹${salesData.totals.lifetimeValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} iconTone="success" />
                <Stat label="ERP customer" value={<span className="text-[15px] font-semibold leading-snug">{salesData.customerNames.join(", ")}</span>} iconTone="info" />
              </div>
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Guardians" value={guardianLinks.length} iconTone="brand" />
          <Stat label="Siblings" value={otherChildren.length} iconTone="info" />
          <Stat label="Addresses" value={savedAddresses.length + addrs.length} iconTone="success" hint={`${savedAddresses.length} from the storefront`} />
          <Stat label="Last updated" value={<span className="text-[16px] font-semibold">{s.syncedAt ? fmtDateTime(s.syncedAt) : "—"}</span>} iconTone="subtle" />
        </div>
      )}

      <div className="mt-5">
        <RecordHistory entityType="student" entityId={id} title="Student history" />
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</div>
      <div className="mt-1 text-[13px] text-ink-900">{children}</div>
    </div>
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

      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 mb-1.5 mt-1">Items</div>
      {items.length === 0 ? (
        <EmptyState title="No line items" description="No items recorded for this order." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100/70 mb-4">
          <table className="w-full">
            <thead><tr><Th>Item</Th><Th>Code</Th><Th right>Qty</Th><Th right>Rate</Th><Th right>Amount</Th><Th right>Delivered</Th><Th right>Returned</Th></tr></thead>
            <tbody>{items.map((it, i) => (
              <Tr key={order.order_no + "-i-" + i}>
                <Td>{it.item_name ?? "—"}</Td>
                <Td muted><span className="font-mono text-[12px]">{it.item_code ?? "—"}</span></Td>
                <Td right muted>{it.qty ?? "—"}</Td>
                <Td right muted>{money(it.rate)}</Td>
                <Td right>{money(it.amount)}</Td>
                <Td right muted>{it.delivered_qty ?? 0}</Td>
                <Td right muted>{it.returned_qty ? <Badge tone="warning" size="sm">{it.returned_qty}</Badge> : "0"}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 mb-1.5">Tracking / shipments</div>
      {shipments.length === 0 ? (
        <p className="text-[13px] text-ink-500 mb-4">No shipment records.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100/70 mb-4">
          <table className="w-full">
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
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 mb-1.5">Payment schedule</div>
      {payments.length === 0 ? (
        <p className="text-[13px] text-ink-500">No payment schedule.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100/70">
          <table className="w-full">
            <thead><tr><Th>Due date</Th><Th right>Amount</Th><Th right>Paid</Th><Th right>Outstanding</Th></tr></thead>
            <tbody>{payments.map((p, i) => (
              <Tr key={order.order_no + "-p-" + i}>
                <Td muted>{p.due_date ?? "—"}</Td>
                <Td right>{money(p.payment_amount)}</Td>
                <Td right muted>{money(p.paid_amount)}</Td>
                <Td right>{(p.outstanding ?? 0) > 0 ? <Badge tone="danger" size="sm">{money(p.outstanding)}</Badge> : money(p.outstanding)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
