import "server-only";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { addresses, parents } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "@/server/importers/_types";
import { pickField } from "@/server/importers/_types";

function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}
function syntheticPhone(erpName: string): string {
  const h = crypto.createHash("md5").update(erpName).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

export const addressImporter: DocTypeImporter = {
  doctype: "Address",
  filenameHints: ["address", "addresses"],
  signatureHeaders: ["address_line1", "city", "pincode", "address_type"],

  async processOne(row: ImportRow) {
    const customerErpName = pickField(row, "link_name", "customer", "Customer");
    if (!customerErpName) return { result: "skipped", error: "missing customer link_name" };

    // Try real phone, fall back to synthetic
    const realPhone = normalizePhone(pickField(row, "phone", "Phone"));
    const lookupPhone = realPhone ?? syntheticPhone(customerErpName);
    const parentRow = await db.select().from(parents).where(eq(parents.phone, lookupPhone)).limit(1);
    if (!parentRow[0]) return { result: "skipped", error: `parent not found for ${customerErpName}` };

    const line1 = pickField(row, "address_line1", "Address Line 1") ?? "—";
    const city = pickField(row, "city", "City") ?? "—";
    const stateName = pickField(row, "state", "State") ?? "—";
    const pincode = pickField(row, "pincode", "Pincode") ?? "000000";

    await db.insert(addresses).values({
      parentId: parentRow[0].id,
      addressTitle: pickField(row, "address_title", "Address Title"),
      addressType: (pickField(row, "address_type", "Address Type") ?? "shipping").toLowerCase() === "billing" ? "billing" : "shipping",
      receiverName: pickField(row, "address_title", "Address Title") ?? parentRow[0].name ?? "Customer",
      receiverPhone: realPhone ?? lookupPhone,
      line1,
      line2: pickField(row, "address_line2", "Address Line 2"),
      city,
      state: stateName,
      pincode,
      country: pickField(row, "country", "Country") ?? "India",
      gstin: pickField(row, "gstin", "GSTIN"),
    });
    return { result: "new" };
  },
};
