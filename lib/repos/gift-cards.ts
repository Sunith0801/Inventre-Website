import "server-only";
import crypto from "crypto";
import { eq, sql, and, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { giftCards, giftCardRedemptions } from "@/db/schema";

/**
 * Gift Cards.
 *
 * Codes are 16-char alphanumeric (uppercase) with a 4-char HMAC checksum
 * suffix to prevent typo / brute-force. Internal table holds balance in paise.
 *
 * Lifecycle: active → redeemed (when balance hits 0) | expired | cancelled.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

function genRaw(): string {
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function checksum(raw: string): string {
  const secret =
    process.env.GIFT_CARD_SECRET ?? process.env.AUTH_SECRET ?? "fallback-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(raw, "utf8")
    .digest("hex")
    .slice(0, 4)
    .toUpperCase();
}

/** Generate a new code. Format: `GC-AAAA-BBBB-CCCC-XXXX`. */
export function generateCode(): string {
  const raw = genRaw();
  const sum = checksum(raw);
  return `GC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${sum}`;
}

/** Validate code shape + checksum without DB lookup. */
export function isValidCode(code: string): boolean {
  const m = /^GC-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z0-9]{4})$/.exec(
    code
  );
  if (!m) return false;
  const raw = m[1] + m[2] + m[3];
  return checksum(raw) === m[4];
}

export async function issueGiftCard(args: {
  amountPaise: number;
  toEmail?: string;
  toPhone?: string;
  toParentId?: string;
  expiresAt?: Date;
  notes?: string;
  createdBy: string;
}): Promise<{ id: string; code: string }> {
  if (args.amountPaise <= 0) throw new Error("amount must be positive");
  const code = generateCode();
  const [created] = await db
    .insert(giftCards)
    .values({
      code,
      initialBalance: args.amountPaise,
      currentBalance: args.amountPaise,
      issuedToEmail: args.toEmail ?? null,
      issuedToPhone: args.toPhone ?? null,
      issuedToParentId: args.toParentId ?? null,
      expiresAt: args.expiresAt ?? null,
      notes: args.notes ?? null,
      createdBy: args.createdBy,
      status: "active",
    })
    .returning();
  return { id: created.id, code };
}

export async function lookupGiftCard(code: string) {
  if (!isValidCode(code)) return null;
  const [row] = await db
    .select()
    .from(giftCards)
    .where(eq(giftCards.code, code))
    .limit(1);
  return row ?? null;
}

/**
 * Redeem against an order. Atomic — locks the row for update so concurrent
 * redemptions can't double-spend.
 */
export async function redeemGiftCard(args: {
  code: string;
  orderId: string;
  amountPaise: number;
}): Promise<{ applied: number; remaining: number }> {
  if (!isValidCode(args.code)) throw new Error("Invalid code");
  if (args.amountPaise <= 0) throw new Error("Amount must be positive");

  return await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(giftCards)
      .where(eq(giftCards.code, args.code))
      .for("update")
      .limit(1);
    if (!card) throw new Error("Gift card not found");
    if (card.status !== "active") {
      throw new Error(`Gift card is ${card.status}`);
    }
    if (card.expiresAt && card.expiresAt < new Date()) {
      await tx
        .update(giftCards)
        .set({ status: "expired" })
        .where(eq(giftCards.id, card.id));
      throw new Error("Gift card has expired");
    }
    if (card.currentBalance <= 0) {
      throw new Error("Gift card has zero balance");
    }
    const applied = Math.min(card.currentBalance, args.amountPaise);
    const remaining = card.currentBalance - applied;
    await tx
      .update(giftCards)
      .set({
        currentBalance: remaining,
        status: remaining === 0 ? "redeemed" : "active",
      })
      .where(eq(giftCards.id, card.id));
    await tx.insert(giftCardRedemptions).values({
      giftCardId: card.id,
      orderId: args.orderId,
      amount: applied,
    });
    return { applied, remaining };
  });
}

export async function listGiftCards(filter: { status?: string } = {}) {
  const conds = [];
  if (filter.status) conds.push(eq(giftCards.status, filter.status));
  return db
    .select()
    .from(giftCards)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(giftCards.issuedAt))
    .limit(200);
}

export async function expireDue(): Promise<number> {
  const result = await db
    .update(giftCards)
    .set({ status: "expired" })
    .where(
      sql`${giftCards.status} = 'active' AND ${giftCards.expiresAt} IS NOT NULL AND ${giftCards.expiresAt} < NOW()`
    )
    .returning({ id: giftCards.id });
  return result.length;
}
