import { NextResponse } from "next/server";
import crypto from "crypto";
import { uploadFile } from "@/lib/storage";

/**
 * PUBLIC photo upload for the Parent Support Portal (mandatory photos on
 * grade-change / payment concerns). No auth — the portal is public. Files
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
