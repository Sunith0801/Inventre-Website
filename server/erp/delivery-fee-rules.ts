/**
 * Delivery Fee Rules — local DB persistence.
 *
 * Originally these were owned by ERPNext (erp.inventre.in). That host
 * was decommissioned in 2026-05, so the rules now live in this app's
 * `delivery_fee_rules` table. The exported function signatures here are
 * the SAME ones the admin actions (app/admin/(protected)/delivery-fee-rules)
 * and checkout (`lib/delivery-fee.ts`) already use — only the storage
 * backend changed.
 *
 * Schema (mirrors the original doctype):
 *   name                     text PK  (DFR-{year}-{counter})
 *   is_active                bool
 *   school                   text     (joins to schools.erp_name)
 *   min_amount               numeric  (rupees)
 *   max_amount               numeric  (rupees; 0 = no upper cap)
 *   delivery_fee             numeric  (rupees)
 *   applicable_item_groups   jsonb    (string[] — flat categories)
 *   created_at, updated_at   timestamp with tz
 *
 * Naming uses `lib/numbering.ts:nextNumber("DFR", year)` so the
 * generated names are stable and human-readable (DFR-2026-1, etc.) and
 * don't collide with legacy ERPNext-imported names if those ever get
 * re-imported into the same table.
 */
import "server-only";
import { eq, desc, asc, isNotNull, and } from "drizzle-orm";
import { db } from "@/db/client";
import {
  deliveryFeeRules,
  schools,
  grades,
} from "@/db/schema";
import { nextNumber } from "@/server/numbering";

export type ApplicableItemGroup = {
  name?: string;
  item_group: string;
};

export type DeliveryFeeRule = {
  name: string;
  is_active: 0 | 1;
  school: string | null;
  min_amount: number;
  max_amount: number;
  delivery_fee: number;
  applicable_item_groups: ApplicableItemGroup[];
  owner?: string | null;
  creation?: string | null;
  modified?: string | null;
  modified_by?: string | null;
};

export type DeliveryFeeRuleInput = {
  is_active: boolean;
  school: string;
  min_amount: number;
  max_amount: number;
  delivery_fee: number;
  applicable_item_groups: string[];
};

export type DeliveryFeeRuleUpdate = Partial<DeliveryFeeRuleInput>;

/**
 * Convert a DB row to the legacy ERPNext-shaped DeliveryFeeRule the
 * existing callers expect. `is_active` returns 0|1 (not boolean) to
 * match the original ERPNext convention used in `lib/delivery-fee.ts`.
 */
function toErpShape(row: typeof deliveryFeeRules.$inferSelect): DeliveryFeeRule {
  return {
    name: row.name,
    is_active: row.isActive ? 1 : 0,
    school: row.school,
    min_amount: Number(row.minAmount),
    max_amount: Number(row.maxAmount),
    delivery_fee: Number(row.deliveryFee),
    applicable_item_groups: (row.applicableItemGroups ?? []).map((g) => ({
      item_group: g,
    })),
    creation: row.createdAt?.toISOString() ?? null,
    modified: row.updatedAt?.toISOString() ?? null,
  };
}

export async function listDeliveryFeeRules(): Promise<DeliveryFeeRule[]> {
  const rows = await db
    .select()
    .from(deliveryFeeRules)
    .orderBy(desc(deliveryFeeRules.updatedAt));
  return rows.map(toErpShape);
}

export async function getDeliveryFeeRule(name: string): Promise<DeliveryFeeRule> {
  const [row] = await db
    .select()
    .from(deliveryFeeRules)
    .where(eq(deliveryFeeRules.name, name))
    .limit(1);
  if (!row) throw new Error(`Delivery Fee Rule not found: ${name}`);
  return toErpShape(row);
}

export async function createDeliveryFeeRule(
  input: DeliveryFeeRuleInput
): Promise<DeliveryFeeRule> {
  const year = String(new Date().getFullYear());
  const seq = await nextNumber("DFR", year);
  const name = `DFR-${year}-${seq}`;
  const [inserted] = await db
    .insert(deliveryFeeRules)
    .values({
      name,
      isActive: input.is_active,
      school: input.school,
      minAmount: String(input.min_amount),
      maxAmount: String(input.max_amount),
      deliveryFee: String(input.delivery_fee),
      applicableItemGroups: input.applicable_item_groups,
    })
    .returning();
  return toErpShape(inserted);
}

export async function updateDeliveryFeeRule(
  name: string,
  patch: DeliveryFeeRuleUpdate
): Promise<DeliveryFeeRule> {
  // Build a sparse update — only the fields that were actually supplied
  // are changed. Mirrors ERPNext's PUT semantics where unspecified
  // fields are left alone.
  const set: Partial<typeof deliveryFeeRules.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.is_active !== undefined) set.isActive = patch.is_active;
  if (patch.school !== undefined) set.school = patch.school;
  if (patch.min_amount !== undefined) set.minAmount = String(patch.min_amount);
  if (patch.max_amount !== undefined) set.maxAmount = String(patch.max_amount);
  if (patch.delivery_fee !== undefined)
    set.deliveryFee = String(patch.delivery_fee);
  if (patch.applicable_item_groups !== undefined)
    set.applicableItemGroups = patch.applicable_item_groups;

  const [updated] = await db
    .update(deliveryFeeRules)
    .set(set)
    .where(eq(deliveryFeeRules.name, name))
    .returning();
  if (!updated) throw new Error(`Delivery Fee Rule not found: ${name}`);
  return toErpShape(updated);
}

export async function deleteDeliveryFeeRule(name: string): Promise<void> {
  await db.delete(deliveryFeeRules).where(eq(deliveryFeeRules.name, name));
}

/** School-name options for the admin Delivery Fee Rule modal — reads
 *  from the local schools table, returning the ERPNext-style names that
 *  the existing rule rows use in their `school` column. */
export async function listSchoolNames(): Promise<string[]> {
  const rows = await db
    .select({ erpName: schools.erpName })
    .from(schools)
    .where(and(eq(schools.status, "active"), isNotNull(schools.erpName)))
    .orderBy(asc(schools.erpName));
  return rows.map((r) => r.erpName!).filter(Boolean);
}

/** Item-group options for the admin Delivery Fee Rule modal — the two
 *  canonical values the admin UI writes ("Uniform" and "Books") matching
 *  the normalization in lib/delivery-fee.ts. */
export async function listItemGroupNames(): Promise<string[]> {
  return ["Uniform", "Books"];
}

/** Grade Link options for the admin Delivery Fee Rule modal — read from
 *  the local `grades` table now that the ERPNext source is retired. */
export async function listGradeNames(): Promise<string[]> {
  const rows = await db
    .select({ name: grades.erpName })
    .from(grades)
    .orderBy(asc(grades.erpName));
  return rows.map((r) => r.name!).filter(Boolean);
}
