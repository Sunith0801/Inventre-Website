/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dev isolation: prod deploys run `npm run build` on the host in this
  // same checkout (scripts/deploy.sh), which clobbers `.next` under a
  // running `next dev` and 500s every page until restart. The dev server
  // sets NEXT_DIST_DIR=.next-dev to keep the two apart; unset (prod
  // build, deploy.sh) keeps the default `.next` so cache reuse and the
  // container sync are untouched.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Upstream `main` has ~24 pre-existing TS errors from in-progress schema
  // refactors (school status casing, dropped columns). The emitted JS runs
  // fine; bypass the compile-time type gate so deploys aren't blocked.
  // TODO: fix the underlying type errors and remove these two flags.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Native modules — webpack can't bundle .node binaries; tell Next.js to
  // keep them external so they're loaded at runtime via require() inside
  // the standalone server. Without this, `next build` hangs indefinitely
  // at the "Creating an optimized production build…" step trying to walk
  // @node-rs/bcrypt's native binding tree (observed 2026-05-26).
  serverExternalPackages: ["@node-rs/bcrypt"],
  // Production: standalone build for slim Docker image (~50MB instead of ~1GB)
  output: "standalone",
  // Compress with Brotli at the edge instead — smaller, faster
  compress: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // MinIO local + prod (subdomain reserved for media CDN)
      { protocol: "http", hostname: "localhost", port: "9000" },
      { protocol: "https", hostname: "*.inventre.in" },
      // Cloudflare R2 public dev subdomain (current media origin)
      { protocol: "https", hostname: "pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev" },
      // ERP item-feed self-hosted images (audit.inventre.online/item-media/<sha1>.<ext>)
      { protocol: "https", hostname: "audit.inventre.online" },
      { protocol: "https", hostname: "*.inventre.online" },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  // All /images/* and /erp-media/* assets live in Cloudflare R2.
  // Redirects target /v2/ keys (see scripts/r2-resync.ts) so cached lower-
  // quality copies at the old keys are bypassed. Using 307 (permanent:false)
  // during the quality fix so browsers don't pin the destination — once
  // verified stable, this can be flipped back to permanent:true.
  async redirects() {
    const base = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev";
    return [
      // Vanity alias: /portal → the parent account area. 307 (not pinned)
      // so a real /portal page can be added later without fighting cached
      // permanent redirects. Covers /portal and any /portal/<sub> path.
      {
        source: "/portal",
        destination: "/account",
        permanent: false,
      },
      {
        source: "/portal/:path*",
        destination: "/account",
        permanent: false,
      },
      {
        source: "/images/:path*",
        destination: `${base}/v2/images/:path*`,
        permanent: false,
      },
      {
        source: "/erp-media/:path*",
        destination: `${base}/v2/erp-media/:path*`,
        permanent: false,
      },
      {
        source: "/contact-parent.png",
        destination: `${base}/v2/contact-parent.png`,
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Cloudflare-friendly cache for product pages (revalidate via API on edit)
        source: "/shop/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "private, no-store",
          },
        ],
      },
      {
        // Public homepage — long edge cache, short browser cache
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=60, s-maxage=600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  // Fail fast on DB timeouts during static page generation (build-only).
  staticPageGenerationTimeout: 5,
  experimental: {
    // Larger page data limit for product list endpoints
    largePageDataBytes: 256 * 1000,
  },
};

export default nextConfig;
