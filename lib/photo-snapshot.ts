/**
 * Browser-side "freeze the photo now" helper for the exchange / missing forms.
 *
 * Why this exists (2026-07-31): parents were stuck on
 * "We couldn't reach Inventre — your internet connection dropped while
 * sending" and NOTHING appeared in nginx for their submit — the request never
 * left the phone. The cause is not the network: a `File` picked from an
 * `<input type="file">` on Android is only a *handle* to a file the OS still
 * owns (`content://…`, the camera's temp JPEG, a Google-Photos placeholder).
 * The forms held that handle from selection until the parent tapped Submit —
 * minutes later, after switching to the camera/gallery app and back. If the
 * OS moved, re-encoded, cleaned up or revoked the file in the meantime, the
 * body stream fails to open and `fetch()` rejects with the same bare
 * `TypeError` a dead connection produces (net::ERR_UPLOAD_FILE_CHANGED /
 * ERR_ACCESS_DENIED). Retrying can't help: the handle stays broken, so the
 * parent loops on "check your connection" forever with a working connection.
 *
 * Fix: copy the bytes into memory at SELECTION time. After this, the upload
 * carries an in-memory blob and no longer depends on the OS file surviving.
 * A file that can't be read is caught here — while the picker is still open
 * and the parent can just pick it again — instead of at Submit.
 *
 * Large camera photos are downscaled on the way through (canvas → JPEG),
 * which also keeps memory sane and makes the upload far more likely to finish
 * on mobile data. Any failure in that path falls back to the raw byte copy.
 */

/** The photo could not be read off the device. Distinct from a network error. */
export class PhotoReadError extends Error {
  constructor(fileName: string, options?: { cause?: unknown }) {
    super(
      `We couldn't read "${fileName}" from your phone — it may have been moved ` +
        `or deleted since you picked it. Please remove it and add the photo again.`,
      options,
    );
    this.name = "PhotoReadError";
  }
}

/** Photos above this get re-encoded; below it the original bytes are kept. */
const DOWNSCALE_ABOVE_BYTES = 2 * 1024 * 1024;
/** Longest edge after downscaling — plenty for a customer-care photo. */
const MAX_EDGE = 2200;
const JPEG_QUALITY = 0.85;

/**
 * Re-encode via canvas. Returns null (caller keeps the original bytes) for
 * anything the browser can't decode — notably HEIC on most Android builds.
 */
async function downscale(blob: Blob, name: string): Promise<File | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!out || out.size === 0) return null;
    // Never let the "optimised" copy be bigger than what we started with.
    if (out.size >= blob.size) return null;
    return new File([out], name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

/**
 * Read `file` into memory and return a File that no longer depends on the
 * device's copy. Throws `PhotoReadError` if the bytes can't be read.
 */
export async function snapshotPhoto(file: File): Promise<File> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    throw new PhotoReadError(file.name, { cause: e });
  }
  // A revoked / vanished content:// handle can also read back as 0 bytes
  // instead of throwing — treat that the same way.
  if (buf.byteLength === 0) throw new PhotoReadError(file.name);

  const type = file.type || "image/jpeg";
  const raw = new Blob([buf], { type });

  if (buf.byteLength > DOWNSCALE_ABOVE_BYTES) {
    const smaller = await downscale(raw, file.name);
    if (smaller) return smaller;
  }
  return new File([raw], file.name, { type, lastModified: file.lastModified });
}
