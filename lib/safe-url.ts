/**
 * Encode unsafe characters in remote image URLs read from the ERP feed.
 *
 * Background: ~90% of `product_images.url` rows contain literal spaces
 * (e.g. "https://erp.inventre.in/files/RED BELT.png"). Modern Chromium
 * browsers (Brave, Edge, Chrome) refuse to fetch <img src> values with
 * raw spaces, so these rows display as broken images. We re-encode the
 * path at the read boundary so the rendered HTML is always valid.
 *
 * Idempotent: pre-encoded segments round-trip cleanly (%20 stays %20,
 * not %2520). Non-URL inputs (relative paths, data: URIs) are returned
 * unchanged.
 *
 * Long-term fix: run the media rehoster (POST /api/admin/erp/rehost-images)
 * to move these to R2 `erp-media/<sha1>.<ext>` keys — sha1 names contain
 * no characters that need encoding.
 */
export function safeImgUrl(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  // Relative ERP path (`/files/RED BELT.png` or `/files/hoodie size guide.jpg`).
  // ERP stores attachments at `<ERP_BASE>/files/...`. The DB only carries
  // the relative path, so we resolve to the ERP origin at the read
  // boundary and URL-encode any unsafe chars (most commonly spaces).
  if (raw.startsWith("/files/") || raw.startsWith("/private/files/")) {
    const base =
      process.env.NEXT_PUBLIC_ERP_BASE ||
      process.env.ERP_FEED_BASE ||
      process.env.STAGING_ERP_API_BASE_URL ||
      process.env.ERP_API_BASE_URL ||
      "";
    const origin = base.replace(/\/$/, "");
    if (!origin) return raw; // no ERP base configured — let the browser try
    const encoded = raw
      .split("/")
      .map((seg) =>
        seg === "" ? "" : encodeURIComponent(decodeURIComponentSafe(seg))
      )
      .join("/");
    return `${origin}${encoded}`;
  }
  try {
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg) => {
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join("/");
    return u.toString();
  } catch {
    return raw;
  }
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
