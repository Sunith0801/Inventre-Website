/**
 * Per-parent draft selection state. A parent can stage their picks on a
 * PDP (multi-axis bookkit) or Magic Box configurator without committing
 * to Add-to-Cart, navigate away (Home / About / Shop), and come back to
 * find their selection intact — across logout / login.
 *
 *   GET    ?productId=<uuid>&studentId=<uuid?>   → { state | null }
 *   POST   { productId, studentId?, state }      → upsert
 *   DELETE ?productId=<uuid>&studentId=<uuid?>   → drop (called on Add-to-Cart success)
 *
 * All routes require an authed parent. Guests rely on localStorage in
 * the client; the page-level draft hook is responsible for syncing
 * localStorage → server on login. See the plan file Group 4.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { productDrafts } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { parseJson } from "@/lib/api-handler";

const StateMultiAxis = z.object({
  kind: z.literal("multi-axis"),
  selection: z.record(z.string(), z.string()),
});
const StateMagicBox = z.object({
  kind: z.literal("magic-box"),
  picks: z.array(
    z.object({
      componentProductId: z.string().uuid(),
      variantId: z.string().uuid().nullable(),
    })
  ),
});
const DraftState = z.discriminatedUnion("kind", [StateMultiAxis, StateMagicBox]);

const PostBody = z.object({
  productId: z.string().uuid(),
  studentId: z.string().uuid().nullable().optional(),
  state: DraftState,
});

/** Build the where-clause that matches `student_id = $1` and also matches
 *  the "no student" case via `student_id IS NULL` — Postgres compares
 *  `= NULL` as unknown otherwise. */
function studentWhere(studentId: string | null | undefined) {
  return studentId ? eq(productDrafts.studentId, studentId) : isNull(productDrafts.studentId);
}

export async function GET(req: Request) {
  const me = await getCurrentParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  const studentId = url.searchParams.get("studentId");
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const [row] = await db
    .select({ state: productDrafts.state })
    .from(productDrafts)
    .where(
      and(
        eq(productDrafts.parentId, me.id),
        eq(productDrafts.productId, productId),
        studentWhere(studentId || null)
      )
    )
    .limit(1);

  return NextResponse.json({ state: row?.state ?? null });
}

export async function POST(req: Request) {
  const me = await getCurrentParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await parseJson(req, PostBody);
  if (body instanceof NextResponse) return body;

  const studentId = body.studentId ?? null;

  // Upsert via the COALESCE-aware unique index from migration 0029. We
  // can't ON CONFLICT against a partial expression index directly, so
  // a defensive delete + insert keeps the contract simple and atomic
  // under a single transaction.
  await db.transaction(async (tx) => {
    await tx
      .delete(productDrafts)
      .where(
        and(
          eq(productDrafts.parentId, me.id),
          eq(productDrafts.productId, body.productId),
          studentWhere(studentId)
        )
      );
    await tx.insert(productDrafts).values({
      parentId: me.id,
      productId: body.productId,
      studentId: studentId ?? null,
      state: body.state,
      updatedAt: new Date(),
    });
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await getCurrentParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  const studentId = url.searchParams.get("studentId");
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  await db
    .delete(productDrafts)
    .where(
      and(
        eq(productDrafts.parentId, me.id),
        eq(productDrafts.productId, productId),
        studentWhere(studentId || null)
      )
    );

  return NextResponse.json({ ok: true });
}
