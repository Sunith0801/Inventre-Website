import { NextResponse } from "next/server";
import { asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  addresses,
  communications,
  concernMessages,
  concerns,
  missingItemClaimItems,
  missingItemClaims,
  otpLogs,
  parents,
  returnItems,
  returns,
  studentGuardianLinks,
} from "@/db/schema";
import { last10 } from "@/lib/phone";
import { PRIVACY_VERSION } from "@/lib/legal/privacy";
import { requireParent, isResponse } from "@/server/parent-guard";
import { listParentOrdersFromErp } from "@/server/erp-customer-orders";
import { getBalance, getLedger } from "@/server/repos/loyalty";

/**
 * GET /api/auth/me/export — "Download my data" (DPDP right of access).
 *
 * Additive, read-only. Assembles one JSON document of everything Inventre
 * holds about the signed-in parent and their children. Each section is
 * fetched independently so one failing query degrades to
 * `{ error: "unavailable" }` instead of failing the whole export.
 *
 * Never included: parents.password_hash, otp_logs.otp_code /
 * transaction_id / ip, and any token or secret column.
 */

export const dynamic = "force-dynamic";

const PROCESSORS = [
  "Audit ERP (fulfilment)",
  "SMS gateway (OTP)",
  "CCAvenue (payments)",
  "Courier partners",
  "Cloudflare R2 (images)",
  "Microsoft 365 (encrypted backups)",
];

const UNAVAILABLE = { error: "unavailable" } as const;

async function section<T>(label: string, fn: () => Promise<T>): Promise<T | typeof UNAVAILABLE> {
  try {
    return await fn();
  } catch {
    // Deliberately no payload in the log line — nothing personal leaks.
    console.error(`[me/export] section ${label} unavailable`);
    return UNAVAILABLE;
  }
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;

  const parentId = me.id;
  const studentIds = me.students.map((s) => s.id);
  const now = new Date();

  const [
    parent,
    guardianLinks,
    addressRows,
    orders,
    exchangeRequests,
    missingClaims,
    concernRows,
    loyalty,
    communicationRows,
    otpDeliveryLog,
  ] = await Promise.all([
    section("parent", async () => {
      const [p] = await db
        .select({
          id: parents.id,
          phone: parents.phone,
          name: parents.name,
          email: parents.email,
          status: parents.status,
          customerGroup: parents.customerGroup,
          tags: parents.tags,
          customerCode: parents.customerCode,
          gstCategory: parents.gstCategory,
          language: parents.language,
          totalLifetimeValue: parents.totalLifetimeValue,
          totalOrderCount: parents.totalOrderCount,
          lastOrderAt: parents.lastOrderAt,
          lastLoginAt: parents.lastLoginAt,
          createdAt: parents.createdAt,
        })
        .from(parents)
        .where(eq(parents.id, parentId))
        .limit(1);
      return p ?? null;
    }),

    section("guardianLinks", async () => {
      if (studentIds.length === 0) return [];
      return db
        .select({
          studentId: studentGuardianLinks.studentId,
          rowIdx: studentGuardianLinks.rowIdx,
          guardianName: studentGuardianLinks.guardianName,
          relation: studentGuardianLinks.relation,
          email: studentGuardianLinks.email,
          phoneNo: studentGuardianLinks.phoneNo,
        })
        .from(studentGuardianLinks)
        .where(inArray(studentGuardianLinks.studentId, studentIds))
        .orderBy(asc(studentGuardianLinks.studentId), asc(studentGuardianLinks.rowIdx));
    }),

    section("addresses", async () =>
      db
        .select()
        .from(addresses)
        .where(eq(addresses.parentId, parentId))
        .orderBy(desc(addresses.isDefault), desc(addresses.createdAt)),
    ),

    // Same call My Orders (/api/orders) uses.
    section("orders", () => listParentOrdersFromErp(parentId)),

    section("exchangeRequests", async () => {
      const heads = await db
        .select()
        .from(returns)
        .where(eq(returns.parentId, parentId))
        .orderBy(desc(returns.createdAt));
      if (heads.length === 0) return [];
      const items = await db
        .select()
        .from(returnItems)
        .where(
          inArray(
            returnItems.returnId,
            heads.map((r) => r.id),
          ),
        );
      return heads.map((r) => ({
        ...r,
        items: items.filter((i) => i.returnId === r.id),
      }));
    }),

    section("missingItemClaims", async () => {
      const heads = await db
        .select()
        .from(missingItemClaims)
        .where(eq(missingItemClaims.parentId, parentId))
        .orderBy(desc(missingItemClaims.createdAt));
      if (heads.length === 0) return [];
      const items = await db
        .select()
        .from(missingItemClaimItems)
        .where(
          inArray(
            missingItemClaimItems.claimId,
            heads.map((c) => c.id),
          ),
        );
      return heads.map((c) => ({
        ...c,
        items: items.filter((i) => i.claimId === c.id),
      }));
    }),

    section("concerns", async () => {
      const cond =
        studentIds.length > 0
          ? or(eq(concerns.parentId, parentId), inArray(concerns.studentId, studentIds))
          : eq(concerns.parentId, parentId);
      const heads = await db
        .select({
          id: concerns.id,
          concernNumber: concerns.concernNumber,
          category: concerns.category,
          subType: concerns.subType,
          status: concerns.status,
          description: concerns.description,
          details: concerns.details,
          contactName: concerns.contactName,
          contactPhone: concerns.contactPhone,
          orderRef: concerns.orderRef,
          studentId: concerns.studentId,
          photos: concerns.photos,
          createdAt: concerns.createdAt,
          updatedAt: concerns.updatedAt,
        })
        .from(concerns)
        .where(cond)
        .orderBy(desc(concerns.createdAt));
      if (heads.length === 0) return [];
      const msgs = await db
        .select({
          concernId: concernMessages.concernId,
          author: concernMessages.author,
          authorName: concernMessages.authorName,
          body: concernMessages.body,
          createdAt: concernMessages.createdAt,
        })
        .from(concernMessages)
        .where(
          inArray(
            concernMessages.concernId,
            heads.map((c) => c.id),
          ),
        )
        .orderBy(asc(concernMessages.createdAt));
      return heads.map((c) => ({
        ...c,
        messages: msgs
          .filter((m) => m.concernId === c.id)
          .map(({ concernId: _omit, ...m }) => m),
      }));
    }),

    section("loyalty", async () => ({
      balance: await getBalance(parentId),
      ledger: await getLedger(parentId, 500),
    })),

    section("communications", async () =>
      db
        .select({
          kind: communications.kind,
          subject: communications.subject,
          body: communications.body,
          direction: communications.direction,
          occurredAt: communications.occurredAt,
        })
        .from(communications)
        .where(eq(communications.parentId, parentId))
        .orderBy(desc(communications.occurredAt)),
    ),

    section("otpDeliveryLog", async () => {
      // Every phone on this family: the primary number plus the number
      // actually signed in with (may differ for a second guardian).
      const phones = Array.from(
        new Set(
          [me.phone, me.loggedInPhone]
            .map((p) => last10(p))
            .filter((p): p is string => !!p),
        ),
      );
      if (phones.length === 0) return [];
      // otp_code, transaction_id and ip are NEVER selected here.
      return db
        .select({
          phone: otpLogs.phone,
          purpose: otpLogs.purpose,
          event: otpLogs.event,
          createdAt: otpLogs.createdAt,
          error: otpLogs.error,
        })
        .from(otpLogs)
        .where(inArray(otpLogs.phone, phones))
        .orderBy(desc(otpLogs.createdAt));
    }),
  ]);

  const doc = {
    generatedAt: now.toISOString(),
    notice: {
      privacyVersion: PRIVACY_VERSION,
      processors: PROCESSORS,
      note: "Orders and invoices are retained as required by tax law even after an erasure request.",
    },
    parent,
    consent: {
      tcAcceptedAt: me.tcAcceptedAt,
      tcAcceptedVersion: me.tcAcceptedVersion,
    },
    students: me.students,
    closedStudents: me.closedStudents,
    guardianLinks,
    addresses: addressRows,
    orders,
    exchangeRequests,
    missingItemClaims: missingClaims,
    concerns: concernRows,
    loyalty,
    communications: communicationRows,
    otpDeliveryLog,
  };

  return new NextResponse(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventre-my-data-${yyyymmdd(now)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
