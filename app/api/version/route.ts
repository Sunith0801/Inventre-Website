import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

/**
 * The running build's fingerprint, so an open tab can notice it is stale.
 *
 * A deploy replaces the container, but a browser that already has the page
 * keeps running the old JS until someone reloads — which is why "it's live"
 * and "I can't see it" were both true. Clients poll this and reload
 * themselves when the id changes.
 *
 * Next writes `.next/BUILD_ID` at build time and it is baked into the image,
 * so it changes on every deploy and never mid-run. Read once at module load;
 * re-reading per request would be a syscall on a hot path for a value that
 * cannot change while the process lives.
 */
const BUILD_ID = (() => {
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    // Dev server, or an unexpected layout — fall back to process start, which
    // still changes on every restart.
    return `dev-${Math.floor(Date.now() / 1000)}`;
  }
})();

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { buildId: BUILD_ID },
    { headers: { "cache-control": "no-store, must-revalidate" } }
  );
}
