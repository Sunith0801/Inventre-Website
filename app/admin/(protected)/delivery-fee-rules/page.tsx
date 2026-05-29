import {
  PageHeader, Card, Th, Td, Tr, Badge, EmptyState,
} from "@/components/admin/ui/primitives";
import { Truck } from "lucide-react";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { deliveryFeeRuleGrades } from "@/db/schema";
import {
  listDeliveryFeeRules,
  listGradeNames,
  listSchoolNames,
} from "@/lib/erp/delivery-fee-rules";
import { NewRuleButton, RuleRowActions } from "./RulesTableClient";
import DeleteRuleButton from "./DeleteRuleButton";
import { BulkAssignCard } from "./BulkAssignCard";

export const dynamic = "force-dynamic";

/** Collapse legacy multi-value item groups ("Books Bundle"/"BOOKKIT"/"Uniforms")
 *  into the two display labels the admin panel writes today. */
function categoryLabel(itemGroup: string): "Uniforms" | "Books" {
  return /book/i.test(itemGroup) ? "Books" : "Uniforms";
}

export default async function DeliveryFeeRulesPage() {
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

  const fmt = (n: number) =>
    n == null
      ? "—"
      : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <div>
      <PageHeader
        eyebrow="ERPNext"
        title="Delivery Fee Rules"
        description={
          loadError
            ? "Couldn't reach ERPNext — see error below"
            : `${rules.length} rule${rules.length === 1 ? "" : "s"} · live from erp.inventre.in`
        }
        actions={<NewRuleButton schools={schools} grades={grades} />}
      />

      {loadError && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-[12px] whitespace-pre-wrap">
          {loadError}
        </div>
      )}

      {!loadError ? <BulkAssignCard schools={schools} grades={grades} /> : null}

      <Card padded={false}>
        {!loadError && rules.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No rules yet"
            description="Click New rule to create one in ERPNext."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>School</Th>
                <Th>Grade</Th>
                <Th>Active</Th>
                <Th>Min</Th>
                <Th>Max</Th>
                <Th>Delivery fee</Th>
                <Th>Categories</Th>
                <Th>Last modified</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const grade = gradeByRule.get(r.name) ?? "";
                return (
                  <Tr key={r.name}>
                    <Td>
                      <span className="font-mono text-[11px] text-ink-700">{r.name}</span>
                    </Td>
                    <Td>{r.school ?? "—"}</Td>
                    <Td>
                      {grade ? (
                        <Badge tone="default" size="sm">{grade}</Badge>
                      ) : (
                        <span className="text-ink-400">all</span>
                      )}
                    </Td>
                    <Td>
                      {r.is_active ? (
                        <Badge tone="success" size="sm">Active</Badge>
                      ) : (
                        <Badge tone="default" size="sm">Inactive</Badge>
                      )}
                    </Td>
                    <Td muted>{fmt(r.min_amount)}</Td>
                    <Td muted>
                      {r.max_amount && r.max_amount > 0 ? fmt(r.max_amount) : <span className="text-ink-400">no cap</span>}
                    </Td>
                    <Td>
                      <b>{fmt(r.delivery_fee)}</b>
                    </Td>
                    <Td>
                      {r.applicable_item_groups.length === 0 ? (
                        <span className="text-ink-400">all</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {Array.from(new Set(r.applicable_item_groups.map((g) => categoryLabel(g.item_group)))).map((label) => (
                            <Badge key={label} tone="info" size="sm">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td muted>
                      {r.modified ? new Date(r.modified).toLocaleDateString("en-IN") : "—"}
                    </Td>
                    <Td>
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
                        onDelete={<DeleteRuleButton name={r.name} />}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
