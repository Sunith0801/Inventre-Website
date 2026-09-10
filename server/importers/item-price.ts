import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { itemPrices, productVariants, priceLists } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "@/server/importers/_types";
import { pickField, pickInt } from "@/server/importers/_types";

export const itemPriceImporter: DocTypeImporter = {
  doctype: "Item Price",
  filenameHints: ["item_price", "item-price", "price", "prices"],
  signatureHeaders: ["item_code", "price_list", "price_list_rate"],

  async processOne(row: ImportRow) {
    const itemCode = pickField(row, "item_code", "Item Code", "sku");
    const priceListName = pickField(row, "price_list", "Price List") ?? "Standard Selling";
    const rate = pickInt(row, "price_list_rate", "Price List Rate", "rate", "price");
    if (!itemCode) return { result: "skipped", error: "missing item_code" };
    if (rate == null) return { result: "skipped", error: "missing price" };

    const variantRow = await db.select().from(productVariants).where(eq(productVariants.sku, itemCode)).limit(1);
    if (!variantRow[0]) return { result: "skipped", error: `variant ${itemCode} not found` };

    let listRow = await db.select().from(priceLists).where(eq(priceLists.name, priceListName)).limit(1);
    if (!listRow[0]) {
      const [created] = await db.insert(priceLists).values({ name: priceListName, appliesTo: "selling" }).returning();
      listRow = [created];
    }

    const priceP = rate * 100;
    const existing = await db
      .select()
      .from(itemPrices)
      .where(and(eq(itemPrices.variantId, variantRow[0].id), eq(itemPrices.priceListId, listRow[0].id)))
      .limit(1);

    if (existing[0]) {
      await db.update(itemPrices).set({ price: priceP, updatedAt: new Date() }).where(eq(itemPrices.id, existing[0].id));
      return { result: "updated" };
    }
    await db.insert(itemPrices).values({ variantId: variantRow[0].id, priceListId: listRow[0].id, price: priceP });
    return { result: "new" };
  },
};
