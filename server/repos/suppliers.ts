import "server-only";
import { eq, asc, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import { suppliers } from "@/db/schema";

export async function listSuppliers(q?: string) {
  const where = q
    ? or(ilike(suppliers.name, `%${q}%`), ilike(suppliers.supplierCode, `%${q}%`))
    : undefined;
  return db.select().from(suppliers).where(where).orderBy(asc(suppliers.name));
}

export async function getSupplier(id: string) {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  return row ?? null;
}

export async function nextSupplierCode(): Promise<string> {
  const rows = await db.select().from(suppliers);
  const next = rows.length + 1;
  return `SUP-${String(next).padStart(4, "0")}`;
}
