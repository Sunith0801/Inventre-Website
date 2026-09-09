/* eslint-disable no-console */
/**
 * Import YIPS (Young India Police School) OFFLINE orders into Inventre.
 *
 * Each order = one native Magic Box (one bundle line + sub-selections, NO
 * bookkit), priced as the SUM of its component SKUs — identical in shape to a
 * web Magic Box order, so it flows to audit unchanged.
 *
 * CSV columns (header row required):
 *   ID, Customer, Item Code, Item Name, Quantity, Status
 * Rows sharing an ID belong to one order. `Status` is per item
 * (Delivered/Packed/Pending/Duplicate, case-insensitive).
 *
 * Per order:
 *   1. Match Customer → enrolled YIPS student (grade + gender + parent).
 *   2. Pick the Magic Box for (gender, grade) via product_grades.
 *   3. Resolve each item code → variant + price (Standard Selling), with the
 *      spelled-colour fix (…RNTBLUE34$$ → the Blue variant).
 *   4. order_number = uppercased source ID (e.g. 25YIPS0001) — its own
 *      namespace, separate from SAL-ORD.
 *   5. payment = paid (offline), subtotal = total = Σ(components),
 *      school-pickup placeholder address (receiver phone = parent phone).
 *   6. Per-item status stored on each bundle selection; order status rolled up
 *      (all delivered → delivered; any pending → confirmed; else packed).
 *   7. enqueueOrderEvent(order.created) → audit.
 *
 * SKIP-AND-REPORT: an order is skipped (never partially written) and logged to
 * the blocked report if: student missing/ambiguous/no-phone/no-grade/no-gender,
 * no Magic Box for grade+gender, mixed customers in one ID, duplicate item
 * lines, item-code≠item-name, unresolved SKU, or missing price. Idempotent:
 * an order already imported for that source ID (by payment reference) is
 * skipped.
 *
 *   DATABASE_URL=… NODE_PATH=<server-only shim> NODE_OPTIONS=--conditions=react-server \
 *     node_modules/.bin/tsx scripts/import-yips-offline-orders.ts <file.csv> [--apply]
 */
import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { and, eq, ilike, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  payments,
  students,
  schools,
  products,
  productVariants,
  productGrades,
  productSchool,
  itemPrices,
  priceLists,
  productAttributes,
  productAttributeValues,
  productVariantAttributes,
  parents,
} from "@/db/schema";
import { enqueueOrderEvent } from "@/lib/erp-bridge";
import { financialYearOf } from "@/lib/invoice-numbering";
import { placeOfSupply } from "@/lib/tax";

const SCHOOL_SLUG = "yips-young-india-police-school";
const PRICE_LIST = "Standard Selling";
const COLOUR_WORDS = ["BLUE", "RED", "GREEN", "PURPLE", "BLACK", "WHITE", "YELLOW", "GREY", "GRAY", "ORANGE", "PINK", "MAROON", "NAVY"];

type Status = "delivered" | "packed" | "pending" | "duplicate";
type CsvRow = { id: string; customer: string; itemCode: string; itemName: string; qty: number; status: Status };
type Resolved = {
  itemCode: string; resolvedSku: string; variantId: string; productId: string;
  name: string; size: string; qty: number; unitPaise: number; linePaise: number; status: Status;
};

const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const inr = (p: number) => `₹${(p / 100).toFixed(2)}`;
const csvCell = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;

function normStatus(raw: string): Status {
  const s = (raw || "").toLowerCase();
  if (s.includes("duplicate")) return "duplicate";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("pack")) return "packed";
  if (s.includes("pend")) return "pending";
  return "pending"; // unknown/blank → treat as not-yet-delivered
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === "," || c === "\t") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    if (c.length < 5) continue;
    rows.push({ id: c[0], customer: c[1], itemCode: c[2], itemName: c[3], qty: parseInt(c[4], 10) || 0, status: normStatus(c[5] || "") });
  }
  return rows;
}

function rollup(statuses: Status[]): "delivered" | "packed" | "confirmed" {
  if (statuses.length > 0 && statuses.every((s) => s === "delivered")) return "delivered";
  if (statuses.some((s) => s === "pending")) return "confirmed";
  return "packed";
}

async function main() {
  const csvPath = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!csvPath) { console.error("usage: import-yips-offline-orders <file.csv> [--apply]"); process.exit(1); }
  console.log(`db=${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":****@")}`);
  console.log(`mode=${apply ? "APPLY (writes orders)" : "DRY RUN (no writes)"}\n`);

  const [school] = await db.select().from(schools).where(eq(schools.slug, SCHOOL_SLUG)).limit(1);
  if (!school) throw new Error(`School not found: ${SCHOOL_SLUG}`);
  const [pl] = await db.select().from(priceLists).where(eq(priceLists.name, PRICE_LIST)).limit(1);
  if (!pl) throw new Error(`Price list not found: ${PRICE_LIST}`);

  const pincode = school.pincode || "500075";
  const baseAddr = {
    line1: `School Pickup — ${school.name}`,
    line2: school.street || "",
    city: school.city || "Hyderabad",
    state: school.state || "Telangana",
    pincode,
  };

  // ── preload students + parents (one pass; matched in memory) ──
  const stuRows = await db
    .select({ id: students.id, name: students.name, firstName: students.firstName, grade: students.grade, gender: students.gender, parentId: students.parentId })
    .from(students).where(eq(students.schoolId, school.id));
  const parentIds = [...new Set(stuRows.map((s) => s.parentId).filter(Boolean) as string[])];
  const parentPhone = new Map<string, string>();
  for (let i = 0; i < parentIds.length; i += 500) {
    const chunk = parentIds.slice(i, i + 500);
    const rows = await db.select({ id: parents.id, phone: parents.phone }).from(parents).where(inArray(parents.id, chunk));
    rows.forEach((r) => parentPhone.set(r.id, r.phone || ""));
  }
  // Index by exact normalized name AND token-sorted name (handles reversed
  // word order, e.g. "Yashritha Begari" ↔ "Begari Yashritha"). De-duped by
  // student id so a student whose name == first_name isn't double-counted.
  const tokenKey = (s: string) => norm(s).split(" ").filter(Boolean).sort().join(" ");
  const byName = new Map<string, Map<string, (typeof stuRows)[number]>>();
  const addKey = (k: string, s: (typeof stuRows)[number]) => {
    if (!k) return;
    if (!byName.has(k)) byName.set(k, new Map());
    byName.get(k)!.set(s.id, s);
  };
  for (const s of stuRows) {
    addKey(norm(s.name), s);
    if (s.firstName) addKey(norm(s.firstName), s);
    addKey(tokenKey(s.name), s);
    if (s.firstName) addKey(tokenKey(s.firstName), s);
  }
  // Subset-token index: a CSV name (e.g. "PIYUSH SHIVA KRISHNA") that omits a
  // trailing surname can still match the enrolled student ("PIYUSH SHIVA
  // KRISHNA GAJJI") IFF its tokens are a subset of exactly one student's tokens.
  const stuTokens = stuRows.map((s) => ({ s, toks: new Set(norm(s.name).split(" ").filter(Boolean)) }));

  // ── preload the 12 YIPS magic boxes keyed by gender|grade ──
  const boxRows = await db
    .select({ pid: products.id, name: products.name, vid: productVariants.id, size: productVariants.size, sku: productVariants.sku, grade: productGrades.grade })
    .from(products)
    .innerJoin(productSchool, and(eq(productSchool.productId, products.id), eq(productSchool.schoolId, school.id)))
    .innerJoin(productGrades, eq(productGrades.productId, products.id))
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(eq(products.kind, "magic_box"));
  const boxByKey = new Map<string, (typeof boxRows)[number]>();
  for (const b of boxRows) {
    const g = /girls/i.test(b.name) ? "Girls" : /boys/i.test(b.name) ? "Boys" : "";
    if (g) boxByKey.set(`${g}|${norm(b.grade)}`, b);
  }

  const skuCache = new Map<string, Resolved | null>();

  const rows = parseCsv(fs.readFileSync(path.resolve(process.cwd(), csvPath), "utf8"));
  const byId = new Map<string, CsvRow[]>();
  const order: string[] = [];
  for (const r of rows) {
    if (!byId.has(r.id)) { byId.set(r.id, []); order.push(r.id); }
    byId.get(r.id)!.push(r);
  }
  console.log(`parsed ${rows.length} line(s) across ${byId.size} order(s)\n`);

  let okCount = 0, skipDup = 0;
  const blocked: { id: string; customer: string; reason: string }[] = [];
  const studentOrderCount = new Map<string, string[]>();

  for (const sourceId of order) {
    const lines = byId.get(sourceId)!;
    const customer = lines[0]?.customer ?? "";
    try {
      // mixed customers in one ID = data error
      if (new Set(lines.map((l) => norm(l.customer))).size > 1)
        throw new Error(`multiple customers under one order ID`);

      // drop Duplicate-status lines
      const active = lines.filter((l) => l.status !== "duplicate");
      if (active.length === 0) throw new Error(`all lines marked Duplicate`);

      // duplicate item-code lines within the order
      const codeCounts = new Map<string, number>();
      active.forEach((l) => codeCounts.set(norm(l.itemCode), (codeCounts.get(norm(l.itemCode)) || 0) + 1));
      const dupCode = [...codeCounts.entries()].find(([, n]) => n > 1);
      if (dupCode) throw new Error(`duplicate item line: "${dupCode[0]}" appears ${dupCode[1]}×`);

      // item code vs item name mismatch — the Item Code column is the SKU
      // master, so we trust it (team decision) and only warn on disagreement.
      for (const l of active)
        if (l.itemName && norm(l.itemCode) !== norm(l.itemName))
          console.log(`   ⚠ code≠name (using code): "${l.itemCode}" vs "${l.itemName}"`);

      // student match (exact normalized name, else token-sorted name)
      const candMap = byName.get(norm(customer)) ?? byName.get(tokenKey(customer));
      let matches = candMap ? [...candMap.values()] : [];
      // fallback: CSV name tokens ⊆ exactly one enrolled student's name tokens
      if (matches.length === 0) {
        const ctoks = norm(customer).split(" ").filter(Boolean);
        if (ctoks.length) {
          const uniq = new Map<string, (typeof stuRows)[number]>();
          for (const { s, toks } of stuTokens) if (ctoks.every((t) => toks.has(t))) uniq.set(s.id, s);
          if (uniq.size === 1) matches = [...uniq.values()];
          else if (uniq.size > 1) throw new Error(`ambiguous student (subset matched ${uniq.size})`);
        }
      }
      if (matches.length === 0) throw new Error(`student not enrolled under YIPS`);
      if (matches.length > 1) throw new Error(`ambiguous student (${matches.length} distinct matches)`);
      const stu = matches[0];
      if (!stu.parentId) throw new Error(`student has no parent`);
      if (!stu.grade) throw new Error(`student has no grade`);
      const phone = parentPhone.get(stu.parentId) || "";
      if (!phone) throw new Error(`parent has no phone`);
      const genderLabel = (stu.gender || "").toLowerCase().startsWith("f") ? "Girls"
        : (stu.gender || "").toLowerCase().startsWith("m") ? "Boys" : "";
      if (!genderLabel) throw new Error(`unknown gender "${stu.gender}"`);

      const box = boxByKey.get(`${genderLabel}|${norm(stu.grade)}`);
      if (!box) throw new Error(`no Magic Box for ${genderLabel} grade "${stu.grade}"`);

      // resolve lines
      const resolved: Resolved[] = [];
      for (const l of active) {
        const r = await resolveLine(l, school.id, pl.id, skuCache);
        resolved.push(r);
      }
      const totalPaise = resolved.reduce((s, r) => s + r.linePaise, 0);
      if (totalPaise <= 0) throw new Error(`order total resolved to 0`);

      const orderNumber = sourceId.toUpperCase().replace(/\s+/g, "");
      const srcKey = `yips-offline:${sourceId.toLowerCase().replace(/\s+/g, "")}`;
      const orderStatus = rollup(resolved.map((r) => r.status));

      studentOrderCount.set(stu.id, [...(studentOrderCount.get(stu.id) ?? []), orderNumber]);

      const d = resolved.filter((r) => r.status === "delivered").length;
      const pk = resolved.filter((r) => r.status === "packed").length;
      const pe = resolved.filter((r) => r.status === "pending").length;
      console.log(`━━ ${sourceId} → ${orderNumber} | ${customer} | ${genderLabel} ${stu.grade} | ${orderStatus} (${d}D/${pk}P/${pe}pend) | ${inr(totalPaise)} | ${resolved.length} items`);

      if (apply) {
        // source-based idempotency (survives any order-number scheme change)
        const existing = await db
          .select({ id: payments.orderId }).from(payments)
          .where(ilike(payments.internalPaymentReference, srcKey)).limit(1);
        if (existing.length) { console.log(`   ↺ already imported (${srcKey}) — skipping`); okCount++; continue; }

        const newOrderId = await db.transaction(async (tx) => {
          const [dup] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
          if (dup) throw new Error(`order ${orderNumber} already exists`);
          const now = new Date();
          const [ord] = await tx.insert(orders).values({
            orderNumber, parentId: stu.parentId!, studentId: stu.id, schoolId: school.id,
            status: orderStatus, paymentStatus: "paid",
            subtotal: totalPaise, tax: 0, shipping: 0, discount: 0, total: totalPaise,
            shippingAddress: { ...baseAddr, receiverName: customer, receiverPhone: phone },
            placedAt: now, confirmedAt: now,
            packedAt: orderStatus === "packed" || orderStatus === "delivered" ? now : null,
            deliveredAt: orderStatus === "delivered" ? now : null,
            schoolNameSnapshot: school.name, gradeSnapshot: stu.grade,
            financialYear: financialYearOf(), placeOfSupply: placeOfSupply(pincode),
            gstCategory: "Unregistered", notes: `Offline YIPS import (source ${sourceId})`, tags: ["yips-offline"],
          }).returning({ id: orders.id });

          await tx.insert(orderItems).values({
            orderId: ord.id, variantId: box.vid, nameSnapshot: box.name, size: box.size,
            qty: 1, unitPrice: totalPaise, total: totalPaise,
            bundleSelections: resolved.map((r) => ({
              componentProductId: r.productId, name: r.name, qty: r.qty,
              variantId: r.variantId, size: r.size, status: r.status,
            })),
          });

          await tx.insert(payments).values({
            orderId: ord.id, provider: "offline", amount: totalPaise, status: "paid",
            paymentFlow: "OFFLINE", gatewayProvider: "OFFLINE", gatewayOrderId: orderNumber,
            internalPaymentReference: srcKey, paidAmount: (totalPaise / 100).toFixed(2),
            paidCurrency: "INR", paymentDate: now.toISOString().slice(0, 10),
            refundStatus: "NOT_REQUESTED", paymentAttemptCount: 1, paymentRetryCount: 0,
            paymentFinalized: true, method: "offline", paymentMode: "Offline",
            gatewayResponseMessage: "YIPS offline order — collected at school",
          });
          return ord.id;
        });
        await enqueueOrderEvent(newOrderId, "order.created");
      }
      okCount++;
    } catch (e: any) {
      blocked.push({ id: sourceId, customer, reason: e.message || String(e) });
    }
  }

  console.log(`\n──────── summary ────────`);
  console.log(`${okCount} order(s) ${apply ? "imported/skipped-idempotent" : "ready"}, ${blocked.length} blocked`);
  const multi = [...studentOrderCount.entries()].filter(([, o]) => o.length > 1);
  if (multi.length) {
    console.log(`\n⚠ ${multi.length} student(s) with >1 order (Magic Box is normally one-per-student):`);
    multi.forEach(([sid, o]) => console.log(`  student ${sid}: ${o.join(", ")}`));
  }
  if (blocked.length) {
    const reportPath = path.resolve(process.cwd(), "scripts/yips-blocked.csv");
    fs.writeFileSync(reportPath, "ID,Customer,Reason\n" + blocked.map((b) => [b.id, b.customer, b.reason].map(csvCell).join(",")).join("\n") + "\n");
    console.log(`\nblocked orders → ${reportPath}`);
    blocked.forEach((b) => console.log(`  ✗ ${b.id} (${b.customer}): ${b.reason}`));
  }
  if (!apply) console.log(`\nDRY RUN — pass --apply to write.`);
}

async function resolveLine(l: CsvRow, schoolId: string, priceListId: string, cache: Map<string, Resolved | null>): Promise<Resolved> {
  const code = l.itemCode.trim();
  const cached = cache.get(code);
  if (cached !== undefined) {
    if (cached === null) throw new Error(`item code not found / unpriced: "${code}"`);
    return { ...cached, qty: l.qty, linePaise: cached.unitPaise * l.qty, status: l.status };
  }
  try {
    let hit = await lookupSku(code);
    let resolvedSku = code;
    if (!hit) {
      // Team-confirmed: Half Pants / Skirt codes that omit the variant letter
      // (e.g. "YIPS Half PantsM26$", "YIPS SkirtM26$") are the "B" variant.
      // Only fires when a digit sits directly before the trailing $ run, so
      // explicit-suffix codes (…M26A$) and missing sizes (…M36$, no M36B) are
      // left to fail naturally.
      const m = code.match(/^(YIPS (?:Half Pants|Skirt)M\d+)(\$+)$/i);
      if (m) {
        const bSku = `${m[1]}B${m[2]}`;
        const bHit = await lookupSku(bSku);
        if (bHit) { hit = bHit; resolvedSku = bSku; }
      }
    }
    if (!hit) {
      const upper = code.toUpperCase();
      const word = COLOUR_WORDS.find((w) => upper.includes(w));
      if (word) {
        const idx = upper.indexOf(word);
        const pattern = code.slice(0, idx) + "_" + code.slice(idx + word.length);
        const cands = await db.select({ id: productVariants.id, sku: productVariants.sku, productId: productVariants.productId })
          .from(productVariants).where(sql`${productVariants.sku} LIKE ${pattern}`);
        for (const c of cands) {
          const colours = await db.select({ value: productAttributeValues.value })
            .from(productVariantAttributes)
            .innerJoin(productAttributeValues, eq(productAttributeValues.id, productVariantAttributes.valueId))
            .innerJoin(productAttributes, eq(productAttributes.id, productVariantAttributes.attributeId))
            .where(and(eq(productVariantAttributes.variantId, c.id), sql`(${productAttributes.name} ILIKE '%colour%' OR ${productAttributes.name} ILIKE '%color%')`));
          if (colours.some((x) => norm(x.value) === norm(word))) { hit = c; resolvedSku = c.sku; break; }
        }
      }
    }
    if (!hit) { cache.set(code, null); throw new Error(`item code not found in catalog: "${code}"`); }

    const [prod] = await db.select({ id: products.id, name: products.name, basePrice: products.basePrice })
      .from(products).where(eq(products.id, hit.productId)).limit(1);
    const [variant] = await db.select({ size: productVariants.size }).from(productVariants).where(eq(productVariants.id, hit.id)).limit(1);
    const [sp] = await db.select({ price: itemPrices.price }).from(itemPrices)
      .where(and(eq(itemPrices.variantId, hit.id), eq(itemPrices.priceListId, priceListId), eq(itemPrices.schoolId, schoolId))).limit(1);
    const [gp] = await db.select({ price: itemPrices.price }).from(itemPrices)
      .where(and(eq(itemPrices.variantId, hit.id), eq(itemPrices.priceListId, priceListId), isNull(itemPrices.schoolId))).limit(1);
    const unitPaise = sp?.price ?? gp?.price ?? 0;
    if (!unitPaise || unitPaise <= 0) { cache.set(code, null); throw new Error(`no price for "${resolvedSku}"`); }

    const base: Resolved = { itemCode: code, resolvedSku, variantId: hit.id, productId: prod.id, name: prod.name, size: variant?.size || "", qty: l.qty, unitPaise, linePaise: unitPaise * l.qty, status: l.status };
    cache.set(code, base);
    return base;
  } catch (e) {
    if (!cache.has(code)) cache.set(code, null);
    throw e;
  }
}

async function lookupSku(sku: string) {
  const [v] = await db.select({ id: productVariants.id, sku: productVariants.sku, productId: productVariants.productId })
    .from(productVariants).where(eq(productVariants.sku, sku)).limit(1);
  return v ?? null;
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
