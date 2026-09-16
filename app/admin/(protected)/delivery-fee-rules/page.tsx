import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState, Stat,
} from "@/components/admin/ui/primitives";
import { Truck } from "lucide-react";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { deliveryFeeRuleGrades } from "@/db/schema";
import {
  listDeliveryFeeRules,
  listGradeNames,
  listSchoolNames,
} from "@/server/erp/delivery-fee-rules";
import { NewRuleButton, RuleRowActions } from "./RulesTableClient";
import { BulkAssignButton } from "./BulkAssignCard";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

/** Collapse legacy multi-value item groups ("Books Bundle"/"BOOKKIT"/"Uniforms")
 *  into the two display labels the admin panel writes today. */
function categoryLabel(itemGroup: string): "Uniforms" | "Books" {
  return /book/i.test(itemGroup) ? "Books" : "Uniforms";
}

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const rupees = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Delivery fee rules — what the storefront adds to a cart, per school
 * (optionally per grade and category). The rules themselves live in
 * ERPNext; this page reads and writes them there.
 */
export default async function DeliveryFeeRulesPage() {
  const guard = await requireAnyPermission("delivery-fees.read", "delivery-fees.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  let rules: Awaited<ReturnType<typeof listDeliveryFeeRules>> = [];
  let schools: string[] = [];
  let grades: string[] = [];
  let loadError: string | null = null;
  try {
    [rules, schools, grades] = await Promise.all([
      listDeliveryFeeRules(),
      listSchoolNames(),
      listGradeNames(),
    ]);
  } catch (e: unknown) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  // Pull per-rule grade scope from our local side-table in one shot.
  const gradeByRule = new Map<string, string>();
  if (rules.length > 0) {
    const rows = await db
      .select({ ruleName: deliveryFeeRuleGrades.ruleName, grade: deliveryFeeRuleGrades.grade })
      .from(deliveryFeeRuleGrades)
      .where(inArray(deliveryFeeRuleGrades.ruleName, rules.map((r) => r.name)));
    for (const r of rows) gradeByRule.set(r.ruleName, r.grade);
  }

  const active = rules.filter((r) => r.is_active === 1).length;
  const schoolsCovered = new Set(rules.filter((r) => r.is_active === 1).map((r) => r.school).filter(Boolean)).size;
  const schoolLabel = (erpName: string | null) => {
    if (!erpName) return "—";
    // ERP names read "SMSAW-St. Michaels School"; show the name, keep the code small.
    const i = erpName.indexOf("-");
    return i > 0 ? { code: erpName.slice(0, i), name: erpName.slice(i + 1).trim() } : { code: "", name: erpName };
  };

  return (
    <div>
      <PageHeader
        eyebrow="Pricing & Tax"
        title="Delivery Fee Rules"
        description={loadError ? "Could not reach ERPNext." : "What the cart charges for delivery, per school. Rules are stored in ERPNext."}
        actions={
          loadError ? undefined : (
            <div className="flex items-center gap-2">
              <BulkAssignButton schools={schools} grades={grades} />
              <NewRuleButton schools={schools} grades={grades} />
            </div>
          )
        }
      />

      {loadError ? (
        <div className="mb-4 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
          {loadError}
        </div>
      ) : (
        <div className="mb-5 grid grid-cols-3 gap-3 lg:gap-4">
          <Stat label="Rules" value={rules.length} />
          <Stat label="Active" value={active} hint={active < rules.length ? `${rules.length - active} inactive` : undefined} />
          <Stat label="Schools covered" value={schoolsCovered} hint={`of ${schools.length} active schools`} />
        </div>
      )}

      <Card padded={false} className="overflow-hidden">
        {!loadError && rules.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No delivery fee rules yet"
            description="Carts ship free until a rule is added. Use New rule for one school or Bulk assign for many."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>School</Th>
                  <Th>Applies to</Th>
                  <Th>Grade</Th>
                  <Th>Cart value</Th>
                  <Th right>Delivery fee</Th>
                  <Th>Status</Th>
                  <Th>Rule</Th>
                  <Th>Modified</Th>
                  <Th right><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const grade = gradeByRule.get(r.name) ?? "";
                  const s = schoolLabel(r.school);
                  const cats = Array.from(new Set(r.applicable_item_groups.map((g) => categoryLabel(g.item_group))));
                  return (
                    <Tr key={r.name}>
                      <Td>
                        {typeof s === "string" ? (
                          <span className="text-ink-300">{s}</span>
                        ) : (
                          <>
                            <span className="block font-semibold text-ink-900">{s.name}</span>
                            {s.code ? <span className="block font-mono text-[11.5px] font-normal text-ink-500">{s.code}</span> : null}
                          </>
                        )}
                      </Td>
                      <Td>
                        {cats.length === 0 ? (
                          <span className="text-ink-500">All products</span>
                        ) : (
                          <span className="inline-flex flex-wrap gap-1">
                            {cats.map((label) => (
                              <Badge key={label} tone={label === "Books" ? "info" : "brand"} size="sm">{label}</Badge>
                            ))}
                          </span>
                        )}
                      </Td>
                      <Td muted>{grade || "All grades"}</Td>
                      <Td muted className="whitespace-nowrap">
                        {r.max_amount && r.max_amount > 0
                          ? `${rupees(r.min_amount ?? 0)} – ${rupees(r.max_amount)}`
                          : (r.min_amount ?? 0) > 0
                            ? `From ${rupees(r.min_amount)}`
                            : "Any"}
                      </Td>
                      <Td right><span className="font-semibold">{rupees(r.delivery_fee)}</span></Td>
                      <Td>
                        <Badge tone={r.is_active ? "success" : "default"} dot size="sm">{r.is_active ? "Active" : "Inactive"}</Badge>
                      </Td>
                      <Td muted><span className="font-mono">{r.name}</span></Td>
                      <Td muted className="whitespace-nowrap">{r.modified ? IST.format(new Date(r.modified)) : "—"}</Td>
                      <Td right>
                        <RuleRowActions
                          schools={schools}
                          grades={grades}
                          initial={{
                            name: r.name,
                            school: r.school ?? "",
                            is_active: r.is_active === 1,
                            min_amount: r.min_amount ?? 0,
                            max_amount: r.max_amount ?? 0,
                            delivery_fee: r.delivery_fee ?? 0,
                            applicable_item_groups: r.applicable_item_groups.map((g) => g.item_group),
                            grade,
                          }}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
