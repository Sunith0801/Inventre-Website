import { NextResponse } from "next/server";
import crypto from "crypto";
import { uploadFile } from "@/server/storage";
import { rateLimit } from "@/server/rate-limit";
import { verifyPortalTicket } from "@/server/portal-ticket";

/**
 * Photo upload for the Parent Support Portal (mandatory photos on
 * grade-change / payment concerns). The portal has no login, so the gate is
 * the upload TICKET the search step hands out (header `x-portal-ticket`,
 * 30 min, bound to the family found) plus a per-IP ceiling — P-16. Files
 * land under `concerns/<uuid>/…`. Not in the middleware matcher, so the
 * 10 MB body cap does not apply.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 6;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const isAllowedImage = (f: File): boolean =>
  ALLOWED_MIME.has(f.type) || ALLOWED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));

export async function POST(req: Request) {
  const ticket = await verifyPortalTicket(req.headers.get("x-portal-ticket"));
  if (!ticket) {
    return NextResponse.json(
      { error: "Please search for the student again before attaching photos." },
      { status: 401 }
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const rl = await rateLimit({ key: `portal:upload:${ip}`, max: 30, windowSeconds: 600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "No files attached" }, { status: 400 });
  if (files.length > MAX_FILES)
    return NextResponse.json({ error: `At most ${MAX_FILES} photos` }, { status: 400 });
  for (const f of files) {
    if (f.size > MAX_BYTES) return NextResponse.json({ error: `"${f.name}" exceeds 25 MB` }, { status: 400 });
    if (!isAllowedImage(f))
      return NextResponse.json({ error: `"${f.name}" must be a JPEG/PNG/WebP/HEIC image` }, { status: 400 });
  }

  const folder = `concerns/${crypto.randomUUID()}`;
  const uploads = await Promise.all(
    files.map(async (f) => {
      const buf = Buffer.from(await f.arrayBuffer());
      return uploadFile({ buffer: buf, contentType: f.type, filename: f.name, folder });
    })
  );

  return NextResponse.json({ photos: uploads });
}
