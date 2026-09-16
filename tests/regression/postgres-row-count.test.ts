import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * REGRESSION GUARD — postgres.js has no `rowCount`.
 *
 * The driver returns a `RowList`, whose affected-row count is `.count`.
 * `.rowCount` is the node-postgres (`pg`) name, it is `undefined` here, and
 * every `res.rowCount ?? 0` therefore evaluated to 0. That silently:
 *
 *   - made both ERP webhooks answer 404 "not found" after a SUCCESSFUL
 *     update, so the audit system was told every replacement-arrived push
 *     had failed;
 *   - made "removed N guardian links" always report 0;
 *   - made the outbound drain always report 0 rows recovered from stuck.
 *
 * TypeScript caught all of it, and `ignoreBuildErrors: true` threw the
 * warnings away. This test is the belt to that braces: it fails if the name
 * comes back anywhere the database result is read.
 */
const SOURCE_DIRS = ["app", "lib", "server", "components"];

function sourceFiles(): string[] {
  return execSync(`git ls-files ${SOURCE_DIRS.join(" ")}`, { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && existsSync(f));
}

describe("postgres.js result shape", () => {
  it("no source file reads .rowCount off a query result", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        // A module may DECLARE its own rowCount field (a report row count);
        // what must never come back is READING it off a driver result.
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*")) return; // prose may name it
        if (/\.rowCount\b/.test(line)) offenders.push(`${file}:${i + 1}  ${code}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still finds the source tree, so the guard cannot pass vacuously", () => {
    expect(sourceFiles().length).toBeGreaterThan(500);
  });
});
