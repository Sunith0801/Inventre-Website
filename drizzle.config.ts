import { config } from "dotenv";
import path from "path";
import type { Config } from "drizzle-kit";

// Drizzle CLI doesn't know about Next.js's .env.local convention; load it
// explicitly. Falls back to .env so prod migrations also work.
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

const url =
  process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? "";

if (!url) {
  throw new Error(
    "DATABASE_DIRECT_URL (preferred) or DATABASE_URL must be set for migrations."
  );
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: false,
  verbose: true,
} satisfies Config;
