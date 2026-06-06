import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { isExchangeTester } from "@/lib/exchange-gate";
import { uploadFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Parent-gated photo upload for exchange requests.
 *
 *   POST /api/returns/upload?orderId=<uuid>
 *   Content-Type: multipart/form-data
 *   field "files" (one or more) — image/jpeg | image/png | image/webp
 *
 * Returns: { photos: [{ url, key }, ...] }
 *
 * Phase 1: gated to EXCHANGE_TESTER_PHONES. Files land under
 *   `returns/<parentId>/<orderId>/...` so a leaked URL maps cleanly
 *   back to its owning request during ops triage.
 */
export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  if (!isExchangeTester(me.phone)) {
    return NextResponse.json(
      { error: "Exchange flow is not available for this account yet." },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Scope: the upload key embeds the orderId, so we must confirm this
  // parent actually owns the order before letting them stage files
  // against its namespace.
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.parentId, me.id)))
    .limit(1);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files attached" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Upload at most ${MAX_FILES} files per request` },
      { status: 400 }
    );
  }
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `"${f.name}" exceeds 8 MB` },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIME.has(f.type)) {
      return NextResponse.json(
        { error: `"${f.name}" must be JPEG, PNG, or WebP (got ${f.type})` },
        { status: 400 }
      );
    }
  }

  const folder = `returns/${me.id}/${orderId}`;
  const uploads = await Promise.all(
    files.map(async (f) => {
      const buf = Buffer.from(await f.arrayBuffer());
      return uploadFile({
        buffer: buf,
        contentType: f.type,
        filename: f.name,
        folder,
      });
    })
  );

  return NextResponse.json({ photos: uploads });
}
