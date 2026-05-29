import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { productAttributes, productAttributeValues, schools } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "./_types";
import { pickField, pickInt } from "./_types";

/**
 * Item Attribute (+ values) importer.
 *
 * Two row shapes accepted in the same file:
 *
 *  - Attribute header rows: have `attribute_name` + `type` (size/color/etc.)
 *  - Value rows: have `attribute_name` + `value` (and optionally `short_code`,
 *    `hex_color`, `display_label`, `sort_order`)
 *
 * Idempotent on (attribute_name) for the attribute, and on
 * (attribute_id, value) for the values.
 */

const TYPE_VALUES = ["size", "color", "design", "model", "other"] as const;
type AttrType = (typeof TYPE_VALUES)[number];

function coerceType(t: string | null): AttrType {
  if (!t) return "other";
  const lc = t.toLowerCase();
  if ((TYPE_VALUES as readonly string[]).includes(lc)) return lc as AttrType;
  if (lc.startsWith("col")) return "color";
  if (lc.startsWith("siz")) return "size";
  return "other";
}

export const attributeImporter: DocTypeImporter = {
  doctype: "Attribute",
  filenameHints: ["attribute", "item_attribute", "itemattribute"],
  signatureHeaders: ["attribute_name", "value", "type"],

  async processOne(row: ImportRow) {
    const attrName = pickField(row, "attribute_name", "Attribute Name");
    if (!attrName) return { result: "skipped", error: "missing attribute_name" };

    // Resolve school scope (optional)
    const schoolName = pickField(row, "school_name", "School");
    let schoolId: string | null = null;
    if (schoolName) {
      const [s] = await db
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.name, schoolName))
        .limit(1);
      schoolId = s?.id ?? null;
    }

    // Locate / create the attribute
    let [attr] = await db
      .select()
      .from(productAttributes)
      .where(eq(productAttributes.name, attrName))
      .limit(1);
    if (!attr) {
      const type = coerceType(pickField(row, "type", "Type"));
      const [created] = await db
        .insert(productAttributes)
        .values({
          name: attrName,
          type,
          schoolId,
          description: pickField(row, "description"),
          sortOrder: pickInt(row, "sort_order") ?? 0,
        })
        .returning();
      attr = created;
    }

    // Value row?
    const value = pickField(row, "value", "Value", "attribute_value");
    if (!value) {
      // Header-only row, attribute already created
      return { result: "new" };
    }

    const existingValue = await db
      .select()
      .from(productAttributeValues)
      .where(
        and(
          eq(productAttributeValues.attributeId, attr.id),
          eq(productAttributeValues.value, value)
        )
      )
      .limit(1);
    if (existingValue[0]) {
      await db
        .update(productAttributeValues)
        .set({
          shortCode: pickField(row, "short_code") ?? existingValue[0].shortCode,
          displayLabel: pickField(row, "display_label") ?? existingValue[0].displayLabel,
          hexColor: pickField(row, "hex_color") ?? existingValue[0].hexColor,
          sortOrder: pickInt(row, "sort_order") ?? existingValue[0].sortOrder,
        })
        .where(eq(productAttributeValues.id, existingValue[0].id));
      return { result: "updated" };
    }
    await db.insert(productAttributeValues).values({
      attributeId: attr.id,
      value,
      shortCode: pickField(row, "short_code"),
      displayLabel: pickField(row, "display_label"),
      hexColor: pickField(row, "hex_color"),
      sortOrder: pickInt(row, "sort_order") ?? 0,
    });
    return { result: "new" };
  },
};
