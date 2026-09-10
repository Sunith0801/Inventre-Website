"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deliveryFeeRuleGrades } from "@/db/schema";
import { getCurrentUser } from "@/server/session";
import {
  createDeliveryFeeRule,
  deleteDeliveryFeeRule,
  updateDeliveryFeeRule,
  type DeliveryFeeRuleInput,
} from "@/server/erp/delivery-fee-rules";
import { bustDeliveryFeeCache } from "@/server/delivery-fee";

type Result = { ok: true; name: string } | { ok: false; error: string };

function readBaseFields(formData: FormData): {
  input: DeliveryFeeRuleInput;
  grade: string;
} | { error: string } {
  const school = String(formData.get("school") || "").trim();
  if (!school) return { error: "Please pick a school" };

  const num = (k: string) => {
    const v = formData.get(k);
    if (v == null || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const itemGroups = formData
    .getAll("applicable_item_groups")
    .map((g) => String(g).trim())
    .filter(Boolean);

  return {
    input: {
      is_active: formData.get("is_active") === "on",
      school,
      min_amount: num("min_amount"),
      max_amount: num("max_amount"),
      delivery_fee: num("delivery_fee"),
      applicable_item_groups: itemGroups,
    },
    grade: String(formData.get("grade") || "").trim(),
  };
}

/** Persist the rule's optional grade scope to our local side-table.
 *  Empty grade → delete the row (= applies to all grades). */
async function upsertGrade(ruleName: string, grade: string) {
  if (!grade) {
    await db
      .delete(deliveryFeeRuleGrades)
      .where(eq(deliveryFeeRuleGrades.ruleName, ruleName));
    return;
  }
  await db
    .insert(deliveryFeeRuleGrades)
    .values({ ruleName, grade })
    .onConflictDoUpdate({
      target: deliveryFeeRuleGrades.ruleName,
      set: { grade, updatedAt: new Date() },
    });
}

export async function createRule(formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return { ok: false, error: "Not signed in" };

  const parsed = readBaseFields(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  try {
    const created = await createDeliveryFeeRule(parsed.input);
    await upsertGrade(created.name, parsed.grade);
    await bustDeliveryFeeCache();
    revalidatePath("/admin/delivery-fee-rules");
    return { ok: true, name: created.name };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateRule(formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return { ok: false, error: "Not signed in" };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "Missing rule name" };

  const parsed = readBaseFields(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  try {
    await updateDeliveryFeeRule(name, parsed.input);
    await upsertGrade(name, parsed.grade);
    await bustDeliveryFeeCache();
    revalidatePath("/admin/delivery-fee-rules");
    return { ok: true, name };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteRule(formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return { ok: false, error: "Not signed in" };
  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "Missing name" };
  try {
    await deleteDeliveryFeeRule(name);
    await db
      .delete(deliveryFeeRuleGrades)
      .where(eq(deliveryFeeRuleGrades.ruleName, name));
    await bustDeliveryFeeCache();
    revalidatePath("/admin/delivery-fee-rules");
    return { ok: true, name };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BulkCreateInput = {
  schoolNames: string[];
  grade: string | null;
  category: "Books" | "Uniform";
  deliveryFee: number;
  minAmount: number;
  maxAmount: number;
  isActive: boolean;
};

export type BulkCreateResult =
  | { ok: true; created: number; ruleNames: string[] }
  | { ok: false; error: string };

/**
 * Bulk-assign delivery-fee rules across N schools in one click. For
 * each selected school we mint a new rule row (createDeliveryFeeRule
 * handles the DFR-{year}-{seq} numbering) and, if a grade is set,
 * insert into the side-table. `bustDeliveryFeeCache` runs once at the
 * end so the storefront sees every new rule simultaneously.
 *
 * Doesn't dedupe against existing rules — admins explicitly chose this
 * combination and may want to create rules even when one already exists
 * (e.g. layering a Grade-5 override on top of a school-wide rule).
 * Duplicates get distinct DFR-* names so neither is lost.
 */
export async function bulkCreateRules(input: BulkCreateInput): Promise<BulkCreateResult> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") return { ok: false, error: "Not signed in" };

  if (!input.schoolNames || input.schoolNames.length === 0) {
    return { ok: false, error: "Pick at least one school" };
  }
  if (input.category !== "Books" && input.category !== "Uniform") {
    return { ok: false, error: "Category must be Books or Uniform" };
  }
  if (!Number.isFinite(input.deliveryFee) || input.deliveryFee < 0) {
    return { ok: false, error: "Delivery fee must be a non-negative number" };
  }

  const grade = input.grade?.trim() || "";
  const createdNames: string[] = [];

  try {
    for (const school of input.schoolNames) {
      const trimmed = school.trim();
      if (!trimmed) continue;
      const created = await createDeliveryFeeRule({
        is_active: input.isActive,
        school: trimmed,
        min_amount: Math.max(0, input.minAmount || 0),
        max_amount: Math.max(0, input.maxAmount || 0),
        delivery_fee: input.deliveryFee,
        applicable_item_groups: [input.category],
      });
      if (grade) {
        await db
          .insert(deliveryFeeRuleGrades)
          .values({ ruleName: created.name, grade })
          .onConflictDoUpdate({
            target: deliveryFeeRuleGrades.ruleName,
            set: { grade, updatedAt: new Date() },
          });
      }
      createdNames.push(created.name);
    }
    await bustDeliveryFeeCache();
    revalidatePath("/admin/delivery-fee-rules");
    return { ok: true, created: createdNames.length, ruleNames: createdNames };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
