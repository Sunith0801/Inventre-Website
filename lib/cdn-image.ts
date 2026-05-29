/**
 * Cloudflare Image Transformations helper.
 *
 * Lets us keep one high-quality master in R2 and request right-sized,
 * format-negotiated variants per device — instead of shipping a 4MB PNG
 * to every viewport. The master file is never re-encoded; Cloudflare
 * generates the variant on the fly at the edge.
 *
 * Requires Cloudflare Image Transformations to be enabled for the zone
 * that fronts the R2 bucket (Dashboard → Speed → Optimization → Image
 * Resizing → "Resize images from any origin: ON"). Until enabled, the
 * `/cdn-cgi/image/...` path returns 404 and we fall back to the raw URL.
 *
 * Docs: https://developers.cloudflare.com/images/transform-images/
 *
 * Usage:
 *   <img src={cdnImage("/images/quality1.png", { width: 800, quality: 90 })} />
 *   <img src={cdnImage(productUrl, { width: 400 })} srcSet={cdnImageSrcSet(productUrl, [400, 800, 1200])} />
 */
export type CdnImageOpts = {
  width?: number;
  height?: number;
  /** 1-100. Default 88 (visually lossless for photos, well above Next.js default 75). */
  quality?: number;
  /** 'auto' negotiates AVIF/WebP/JPEG via Accept header. Default 'auto'. */
  format?: "auto" | "avif" | "webp" | "jpeg" | "png";
  /** Default 'cover' for thumbnails; 'contain' preserves entire image. */
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  /** Set true to disable transformation and serve the original master. */
  raw?: boolean;
};

/**
 * Toggle: when Image Transformations isn't yet enabled in the Cloudflare
 * dashboard, set NEXT_PUBLIC_CF_IMAGE_RESIZING=0 to bypass /cdn-cgi/image/.
 * Defaults to enabled.
 */
const ENABLED = process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING !== "0";

/** The hostname that proxies the R2 bucket. Must be on a Cloudflare zone for /cdn-cgi/image/ to work. */
const CDN_HOST = process.env.NEXT_PUBLIC_MEDIA_CDN_HOST ?? ""; // e.g. "media.inventre.in"

export function cdnImage(src: string, opts: CdnImageOpts = {}): string {
  if (!src) return src;
  if (opts.raw || !ENABLED) return src;
  // pub-*.r2.dev is NOT on the user's Cloudflare zone — /cdn-cgi/image/ won't
  // work there. Only rewrite when we have a configured CDN host.
  if (!CDN_HOST) return src;

  const params: string[] = [];
  if (opts.width) params.push(`width=${opts.width}`);
  if (opts.height) params.push(`height=${opts.height}`);
  params.push(`quality=${opts.quality ?? 88}`);
  params.push(`format=${opts.format ?? "auto"}`);
  if (opts.fit) params.push(`fit=${opts.fit}`);

  // Normalize src: if it's an absolute URL, use as-is; if it's a site-relative
  // path like /images/foo.png, point at the CDN host directly.
  const origin = src.startsWith("http") ? src : `https://${CDN_HOST}${src}`;
  return `https://${CDN_HOST}/cdn-cgi/image/${params.join(",")}/${origin}`;
}

/**
 * Build a srcset for responsive sizing. Widths in CSS pixels; the browser
 * picks the right one based on viewport and DPR.
 *
 *   srcSet={cdnImageSrcSet("/images/hero.png", [480, 800, 1200, 1920])}
 *   sizes="(max-width: 768px) 100vw, 800px"
 */
export function cdnImageSrcSet(src: string, widths: number[], opts: Omit<CdnImageOpts, "width"> = {}): string {
  return widths.map((w) => `${cdnImage(src, { ...opts, width: w })} ${w}w`).join(", ");
}
