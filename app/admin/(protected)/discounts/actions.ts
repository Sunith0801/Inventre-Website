"use server";

import "server-only";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  schools,
  websiteCartCoupons,
  websiteCartCouponUsages,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

// Crockford-style alphabet — drops 0/O/1/I/L so admins reading codes off
// a printed list don't fat-finger them. 31 chars ^ 6 ≈ 887 million codes
// in the namespace — collisions effectively never happen.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
// Inventre coupon-code shape: "INV" + 6 random chars, no separator.
// Hardcoded per ops policy so every coupon is instantly identifiable as
// internally-minted.
const FIXED_PREFIX = "INV";
const BODY_LEN = 6;

function genRandomCode(): string {
  const bytes = crypto.randomBytes(BODY_LEN);
  let body = "";
  for (let i = 0; i < BODY_LEN; i++)
    body += ALPHABET[bytes[i] % ALPHABET.length];
  return `${FIXED_PREFIX}${body}`;
}

// ── bulkGenerateCoupons ─────────────────────────────────────────────────
export type BulkGenerateInput = {
  /** ERP-name list. null or [] = universal (no school scope). */
  schoolErpNames: string[] | null;
  /** Discount value in rupees. Fixed-type only — set on every minted row. */
  discount: number;
  /** ISO strings; null = no window. */
  startDatetime: string | null;
  endDatetime: string | null;
  quantity: number;
  oneTimeUse: boolean;
};

export type BulkGenerateResult =
  | { ok: true; created: number; codes: string[] }
  | { ok: false; error: string };

export async function bulkGenerateCoupons(
  input: BulkGenerateInput,
): Promise<BulkGenerateResult> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin")
    return { ok: false, error: "Not signed in as admin" };

  const qty = Math.floor(input.quantity);
  if (!Number.isFinite(qty) || qty < 1 || qty > 1000)
    return { ok: false, error: "Quantity must be between 1 and 1000" };
  const fee = Number(input.discount);
  if (!Number.isFinite(fee) || fee < 0)
    return { ok: false, error: "Discount must be a non-negative number" };

  const start = input.startDatetime ? new Date(input.startDatetime) : null;
  const end = input.endDatetime ? new Date(input.endDatetime) : null;
  if (start && Number.isNaN(start.getTime()))
    return { ok: false, error: "Invalid start date" };
  if (end && Number.isNaN(end.getTime()))
    return { ok: false, error: "Invalid end date" };
  if (start && end && end < start)
    return { ok: false, error: "End date must be after start date" };

  // Resolve school erp_name → school_id (or empty for universal). We persist
  // both columns so the checkout-side validator (which reads schoolId) and
  // the legacy ERP filter (which reads schoolErpName) both work.
  const schoolErpList = (input.schoolErpNames ?? [])
    .map((n) => n.trim())
    .filter(Boolean);
  const schoolPairs: Array<{ erpName: string; id: string }> = [];
  if (schoolErpList.length > 0) {
    const rows = await db
      .select({ erpName: schools.erpName, id: schools.id })
      .from(schools)
      .where(inArray(schools.erpName, schoolErpList));
    for (const r of rows) if (r.erpName) schoolPairs.push({ erpName: r.erpName, id: r.id });
    if (schoolPairs.length === 0)
      return { ok: false, error: "None of the selected schools were found locally" };
  }

  // If schools were chosen, mint `quantity` codes per school. If not, mint
  // `quantity` universal codes. This matches the user's mental model: "5
  // coupons each for 3 schools = 15 codes".
  const targets: Array<{ schoolErpName: string | null; schoolId: string | null }> =
    schoolPairs.length > 0
      ? schoolPairs.map((s) => ({ schoolErpName: s.erpName, schoolId: s.id }))
      : [{ schoolErpName: null, schoolId: null }];

  const createdCodes: string[] = [];

  for (const t of targets) {
    for (let i = 0; i < qty; i++) {
      let inserted = false;
      // Retry up to 5x on collision against the UNIQUE LOWER(coupon_code)
      // index. With a 31^6 keyspace this should never actually loop.
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const code = genRandomCode();
        try {
          await db.insert(websiteCartCoupons).values({
            couponCode: code,
            isActive: true,
            schoolId: t.schoolId,
            schoolErpName: t.schoolErpName,
            startDatetime: start,
            endDatetime: end,
            oneTimeUse: input.oneTimeUse,
            canUseMultipleTimes: false,
            discountType: "Fixed",
            discount: String(fee),
            maximumDiscountAmount: 0,
          });
          createdCodes.push(code);
          inserted = true;
        } catch (e) {
          // Postgres unique_violation = 23505. Retry on collision, bail otherwise.
          const msg = e instanceof Error ? e.message : String(e);
          if (!/duplicate key|23505/.test(msg)) {
            return { ok: false, error: `Insert failed: ${msg}` };
          }
        }
      }
      if (!inserted)
        return {
          ok: false,
          error: `Could not mint a unique coupon code after 5 attempts (created ${createdCodes.length} so far)`,
        };
    }
  }

  revalidatePath("/admin/discounts");
  return { ok: true, created: createdCodes.length, codes: createdCodes };
}

// ── bulkExtendExpiry ────────────────────────────────────────────────────
export type BulkExtendFilter = {
  schoolErpName?: string;
  /** ISO datetime — only coupons currently ending before this are touched. */
  currentEndBefore?: string;
  codePrefix?: string;
  /** Only coupons with ≥1 redemption. */
  usedOnly?: boolean;
  /** Only coupons whose is_active flag is true. */
  activeOnly?: boolean;
};

export type BulkExtendInput = {
  filter: BulkExtendFilter;
  newEndDatetime: string;
  /** If true, returns the count of matched rows without updating. */
  dryRun?: boolean;
};

export type BulkExtendResult =
  | { ok: true; matched: number; updated: number }
  | { ok: false; error: string };

export async function bulkExtendExpiry(
  input: BulkExtendInput,
): Promise<BulkExtendResult> {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin")
    return { ok: false, error: "Not signed in as admin" };

  const newEnd = new Date(input.newEndDatetime);
  if (Number.isNaN(newEnd.getTime()))
    return { ok: false, error: "Invalid new end date" };

  const where: SQL[] = [];
  const f = input.filter ?? {};
  if (f.schoolErpName)
    where.push(eq(websiteCartCoupons.schoolErpName, f.schoolErpName));
  if (f.codePrefix)
    where.push(ilike(websiteCartCoupons.couponCode, `${f.codePrefix}%`));
  if (f.activeOnly) where.push(eq(websiteCartCoupons.isActive, true));
  if (f.currentEndBefore) {
    const cutoff = new Date(f.currentEndBefore);
    if (Number.isNaN(cutoff.getTime()))
      return { ok: false, error: "Invalid currentEndBefore date" };
    where.push(lt(websiteCartCoupons.endDatetime, cutoff));
  }
  if (f.usedOnly) {
    where.push(
      sql`EXISTS (SELECT 1 FROM ${websiteCartCouponUsages} u WHERE u.coupon_id = ${websiteCartCoupons.id})`,
    );
  }
  // Always: never push expiry BACKWARDS for a row that already expires later.
  // Typed helpers — Drizzle binds the Date correctly. (A raw sql`...` with
  // a Date interpolation chokes postgres-js, since it only binds primitives.)
  where.push(
    or(
      isNull(websiteCartCoupons.endDatetime),
      lt(websiteCartCoupons.endDatetime, newEnd),
    )!,
  );

  const matchedRows = await db
    .select({ id: websiteCartCoupons.id })
    .from(websiteCartCoupons)
    .where(where.length ? and(...where) : undefined);
  const matched = matchedRows.length;

  if (input.dryRun) return { ok: true, matched, updated: 0 };
  if (matched === 0) return { ok: true, matched: 0, updated: 0 };

  const ids = matchedRows.map((r) => r.id);
  const res = await db
    .update(websiteCartCoupons)
    .set({ endDatetime: newEnd })
    .where(inArray(websiteCartCoupons.id, ids))
    .returning({ id: websiteCartCoupons.id });

  revalidatePath("/admin/discounts");
  return { ok: true, matched, updated: res.length };
}
