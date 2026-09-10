import "server-only";
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "@/server/importers/_types";
import { pickField } from "@/server/importers/_types";

function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function syntheticPhone(erpName: string): string {
  const h = crypto.createHash("md5").update(erpName).digest("hex");
  const num = parseInt(h.slice(0, 12), 16) % 100_000_000;
  return `90${String(num).padStart(8, "0")}`;
}

async function nextCustomerCode(): Promise<string> {
  const { allocCustomerCode } = await import("@/server/numbering");
  return allocCustomerCode();
}

export const customerImporter: DocTypeImporter = {
  doctype: "Customer",
  filenameHints: ["customer", "customers", "parent"],
  signatureHeaders: ["customer_name", "mobile_no", "email_id"],

  async processOne(row: ImportRow) {
    const erpName = pickField(row, "name", "Name", "ID");
    const customerName = pickField(row, "customer_name", "Customer Name");
    if (!customerName && !erpName) {
      return { result: "skipped", error: "missing customer_name and name" };
    }

    const realPhone = normalizePhone(pickField(row, "mobile_no", "Mobile No", "phone"));
    const phone = realPhone ?? (erpName ? syntheticPhone(erpName) : null);
    if (!phone) {
      return { result: "skipped", error: "no phone, no erp name to hash" };
    }

    const email = pickField(row, "email_id", "Email", "email");
    const language = pickField(row, "language") ?? "en";
    const gstCategory = pickField(row, "gst_category", "GST Category") ?? "Unregistered";
    const customerGroup = pickField(row, "customer_group", "Customer Group") ?? "student";
    const disabled = pickField(row, "disabled", "Disabled") === "1";
    const isFrozen = pickField(row, "is_frozen", "Is Frozen") === "1";

    const existing = await db.select().from(parents).where(eq(parents.phone, phone)).limit(1);
    if (existing[0]) {
      await db
        .update(parents)
        .set({
          name: customerName ?? existing[0].name,
          email: email ?? existing[0].email,
          status: disabled ? "blocked" : existing[0].status,
          language,
          gstCategory,
          isFrozen,
          customerGroup,
        })
        .where(eq(parents.id, existing[0].id));
      return { result: "updated" };
    }

    const code = await nextCustomerCode();
    await db.insert(parents).values({
      phone,
      name: customerName ?? null,
      email: email ?? null,
      status: disabled ? "blocked" : realPhone ? "active" : "blocked",
      language,
      gstCategory,
      isFrozen,
      customerGroup,
      customerCode: code,
      tags: realPhone ? null : ["csv-imported", "phoneless"],
      notes: realPhone ? null : `CSV-imported phoneless customer. ERP name: ${erpName}`,
    });
    return { result: "new" };
  },
};
