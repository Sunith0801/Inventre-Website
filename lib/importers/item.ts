import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { products, categories, schools, productSchool } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "./_types";
import { pickField, pickInt, pickNumber } from "./_types";
import { buildQrPayload, renderQrSvg } from "@/lib/qr";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const HSN_TREATMENT: Record<string, "taxable" | "nil_rated"> = {
  "61012000": "nil_rated",
  "61022000": "nil_rated",
};

export const itemImporter: DocTypeImporter = {
  doctype: "Item",
  filenameHints: ["item", "items", "product", "products"],
  signatureHeaders: ["item_code", "item_name", "item_group"],

  async processOne(row: ImportRow) {
    const itemCode = pickField(row, "name", "item_code", "Item Code", "ID");
    const itemName = pickField(row, "item_name", "Item Name") ?? itemCode;
    const itemGroup = pickField(row, "item_group", "Item Group");
    const hasVariants = pickField(row, "has_variants", "Has Variants") === "1";
    const variantOf = pickField(row, "variant_of", "Variant Of");
    const disabled = pickField(row, "disabled", "Disabled") === "1";

    if (!itemCode) return { result: "skipped", error: "missing item_code" };
    // Skip variants — they're handled by the variant importer (Item with variant_of set)
    if (variantOf) return { result: "skipped", error: "variant — use variant importer" };

    const categoryRow = itemGroup
      ? await db.select().from(categories).where(eq(categories.slug, slugify(itemGroup))).limit(1)
      : [];
    if (itemGroup && !categoryRow[0]) {
      return { result: "skipped", error: `category not found: ${itemGroup}` };
    }

    const hsn = pickField(row, "gst_hsn_code", "HSN") ?? null;
    const treatment = (hsn && HSN_TREATMENT[hsn]) ? HSN_TREATMENT[hsn] : "taxable";
    const inclusiveFlag = (pickField(row, "custom_gst_inclusiveexclusive", "GST Inclusive") || "Inclusive").toLowerCase();
    const gstInclusive = inclusiveFlag !== "exclusive";

    const dispP = (pickInt(row, "custom_display_price", "Display Price") ?? 0) * 100;
    const orgMrpP = (pickInt(row, "custom_organization_mrp", "Org MRP") ?? 0) * 100 || null;
    const costP = (pickInt(row, "custom_inventre_cost_price", "Cost Price") ?? 0) * 100 || null;
    const weightG = pickNumber(row, "custom_weight", "Weight") ? Math.round(pickNumber(row, "custom_weight", "Weight")! * 1000) : null;

    const slug = slugify(itemCode!);
    const payload = {
      slug,
      name: itemName!,
      categoryId: categoryRow[0]?.id ?? null,
      basePrice: dispP || 0,
      baseMrp: orgMrpP,
      status: (disabled ? "archived" : "active") as "archived" | "active",
      itemCode,
      hsnCode: hsn,
      gstTreatment: treatment,
      gstInclusive,
      weightGrams: weightG,
      displayPrice: dispP || null,
      costPrice: costP,
      organizationMrp: orgMrpP,
    };

    const existing = await db.select().from(products).where(eq(products.itemCode, itemCode!)).limit(1);
    let productId: string;
    if (existing[0]) {
      await db.update(products).set(payload).where(eq(products.id, existing[0].id));
      productId = existing[0].id;
    } else {
      const qrPayload = buildQrPayload({ itemCode: itemCode!, itemName: itemName!, weightGrams: weightG, dimensions: null });
      const [created] = await db
        .insert(products)
        .values({ ...payload, qrCodeData: qrPayload, qrCodeSvg: renderQrSvg(qrPayload) })
        .returning();
      productId = created.id;
    }

    // Link to school if custom_school_name present
    const schoolName = pickField(row, "custom_school_name", "School");
    if (schoolName) {
      const sch = await db.select().from(schools).where(eq(schools.name, schoolName)).limit(1);
      if (sch[0]) {
        await db
          .insert(productSchool)
          .values({ productId, schoolId: sch[0].id, isRequired: false })
          .onConflictDoNothing();
      }
    }

    return { result: existing[0] ? "updated" : "new" };
  },
};
