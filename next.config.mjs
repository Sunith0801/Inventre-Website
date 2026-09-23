import { execSync } from "node:child_process";

// Build provenance, baked into the bundle at `next build` time and served by
// /api/version. Why: production is built from this checkout's WORKING TREE,
// and on 2026-09-10 a build from the wrong checkout replaced production twice
// with nothing to say which commit was serving. Now every running build can
// name its commit, branch and whether the tree was dirty when it was built;
// scripts/verify-deployment.sh refuses to pass a deploy whose live commit is
// not the one it just built.
const git = (cmd, fallback = "unknown") => {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
};
const BUILD_GIT_SHA = process.env.BUILD_GIT_SHA || git("rev-parse HEAD");
const BUILD_GIT_BRANCH = process.env.BUILD_GIT_BRANCH || git("rev-parse --abbrev-ref HEAD");
const BUILD_GIT_DIRTY =
  process.env.BUILD_GIT_DIRTY ||
  (git("status --porcelain -- app components lib server db scripts middleware.ts instrumentation.ts package.json next.config.mjs", "") ? "true" : "false");
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    BUILD_GIT_SHA,
    BUILD_GIT_BRANCH,
    BUILD_GIT_DIRTY,
    BUILD_TIME,
  },
  reactStrictMode: true,
  // Dev isolation: prod deploys run `npm run build` on the host in this
  // same checkout (scripts/deploy.sh), which clobbers `.next` under a
  // running `next dev` and 500s every page until restart. The dev server
  // sets NEXT_DIST_DIR=.next-dev to keep the two apart; unset (prod
  // build, deploy.sh) keeps the default `.next` so cache reuse and the
  // container sync are untouched.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Application code is now TYPE-CLEAN: `npm run typecheck` (tsconfig.check.json
  // over app, components, lib, server, db, tests) passes with zero errors, and
  // scripts/deploy.sh refuses to build unless it does.
  //
  // These two flags stay for a narrower reason. `next build` typechecks through
  // tsconfig.json, which also covers scripts/ (7 errors in one-off ops scripts
  // that never ship) and the generated types of every dist dir this repo uses
  // — .next, .next-dev, .next-verify — so a stale dev build can fail a
  // production build for reasons unrelated to the code. The gate that matters
  // is the deterministic one in the deploy preflight.
  //
  // eslint: there is no ESLint config in this repo at all; `next lint` offers
  // to create one. Enabling it is a separate piece of work, not a flag flip.
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
      // (/portal is now a real page — the parent concern portal — so the
      // earlier /portal → /account redirect was removed.)
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
        /**
         * SECURITY HEADERS — every route.
         *
         * Chosen so that none of them can change how a page renders. What is
         * deliberately NOT here matters as much as what is:
         *
         *  - HSTS carries no `includeSubDomains`. inventre.in has at least
         *    four live subdomains (testing, staging, audit, erp) and the flag
         *    is a one-year commitment on ALL of them, including any not
         *    enumerated here. Add it once that list is known and confirmed
         *    TLS-only; certbot.timer is active and the apex cert renews.
         *  - Permissions-Policy denies camera, microphone, geolocation,
         *    payment, usb and bluetooth because the codebase calls none of
         *    them (verified: zero references). The /fit camera flow lives on
         *    a dev branch and is not in this tree — revisit `camera=()` when
         *    it ships.
         *  - The enforcing CSP restricts only what cannot break a render:
         *    who may frame us, plugin embedding, and <base>. Script and style
         *    sources are NOT restricted here: Next.js emits inline bootstrap
         *    scripts, so a strict script-src needs per-request nonces, and
         *    this app also embeds third-party map iframes on the store pages.
         *    The full strict policy ships alongside as Report-Only so the
         *    violations can be read from real traffic before it is enforced.
         */
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://images.unsplash.com https://*.inventre.in https://*.inventre.online https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev",
              "font-src 'self' data:",
              "connect-src 'self' https://*.inventre.in https://*.inventre.online",
              "frame-src https://www.google.com https://maps.google.com",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
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
