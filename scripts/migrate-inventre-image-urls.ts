/**
 * One-shot data migration: rewrite any DB rows that still embed
 * `https://inventre.in/images/...` URLs (or http variant) so they point at
 * the local `/images/...` path now served from `public/images/`.
 *
 * Idempotent — safe to re-run. Operates on every text-bearing table that
 * could plausibly hold a hot-linked URL.
 *
 * Usage:  tsx scripts/migrate-inventre-image-urls.ts
 */

import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

// (table, expression-or-column) pairs. JSONB columns get string replacement
// over their serialized form, which preserves structure.
const jobs: { name: string; statement: string }[] = [
  // Hero video + InTheWild videos + any default home block live in content_blocks.body (jsonb)
  {
    name: "content_blocks.body",
    statement: `
      UPDATE content_blocks
         SET body = regexp_replace(body::text, 'https?://inventre\\.in/images/', '/images/', 'g')::jsonb
       WHERE body::text ~ 'https?://inventre\\.in/images/'
    `,
  },
  // media table — generic media URL column
  {
    name: "media.url",
    statement: `
      UPDATE media
         SET url = regexp_replace(url, 'https?://inventre\\.in/images/', '/images/', 'g')
       WHERE url ~ 'https?://inventre\\.in/images/'
    `,
  },
  // testimonials avatar / photo URLs
  {
    name: "testimonials.avatar_url",
    statement: `
      UPDATE testimonials
         SET avatar_url = regexp_replace(avatar_url, 'https?://inventre\\.in/images/', '/images/', 'g')
       WHERE avatar_url ~ 'https?://inventre\\.in/images/'
    `,
  },
  // schools banner + logo (fallback in StudentBar.tsx)
  {
    name: "schools.banner_url",
    statement: `
      UPDATE schools
         SET banner_url = regexp_replace(banner_url, 'https?://inventre\\.in/images/', '/images/', 'g')
       WHERE banner_url ~ 'https?://inventre\\.in/images/'
    `,
  },
  {
    name: "schools.logo_url",
    statement: `
      UPDATE schools
         SET logo_url = regexp_replace(logo_url, 'https?://inventre\\.in/images/', '/images/', 'g')
       WHERE logo_url ~ 'https?://inventre\\.in/images/'
    `,
  },
  // productImages — seeded rows may point at the old host
  {
    name: "product_images.url",
    statement: `
      UPDATE product_images
         SET url = regexp_replace(url, 'https?://inventre\\.in/images/', '/images/', 'g')
       WHERE url ~ 'https?://inventre\\.in/images/'
    `,
  },
];

(async () => {
  let total = 0;
  for (const job of jobs) {
    try {
      const result = await sql.unsafe(job.statement);
      const n = (result as unknown as { count: number }).count ?? 0;
      total += n;
      console.log(`${job.name}: ${n} rows updated`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Missing column/table just means this schema version doesn't have it — fine.
      if (/relation .* does not exist|column .* does not exist/.test(msg)) {
        console.log(`${job.name}: skipped (${msg.split("\n")[0]})`);
      } else {
        console.error(`${job.name}: ERROR — ${msg}`);
      }
    }
  }
  console.log(`---\nTotal rows rewritten: ${total}`);
  await sql.end();
})();
