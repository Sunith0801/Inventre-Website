import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * EXECUTABLE ARCHITECTURE RULES.
 *
 * Every rule here encodes something this codebase has actually got wrong, so
 * that getting it wrong again fails a test instead of reaching production
 * quietly. They are not style preferences; each one maps to a real incident:
 *
 *   - 121 admin pages were reachable by any signed-in staff account because
 *     the layout checked authentication and nothing checked authorization.
 *   - An ERP replay endpoint checked `kind === "admin"` and let any of the
 *     fourteen staff accounts re-push an order.
 *   - A production connection string has been in the repository since the
 *     first commit, and a second one was still inline in a route handler.
 *   - Security headers were added in the morning and were gone by noon
 *     because a rebuild came from a branch that did not have them.
 *
 * The rules run in CI on every branch AND in the deploy preflight, so the
 * only way past them is to change the rule deliberately — which is a diff
 * somebody reviews.
 */

const sh = (cmd: string) => execSync(cmd, { encoding: "utf8" }).trim();
const tracked = (glob: string) => sh(`git ls-files ${glob}`).split("\n").filter(Boolean);

describe("admin authorization", () => {
  /**
   * A permission belongs to a SECTION. Each top-level directory under the
   * (protected) group carries a layout that gates everything beneath it, so a
   * new page inherits the gate instead of arriving unguarded — which is how
   * 121 pages ended up open.
   */
  it("every admin section carries a permission gate", () => {
    const base = "app/admin/(protected)";
    const sections = sh(`find '${base}' -mindepth 1 -maxdepth 1 -type d`).split("\n").filter(Boolean);
    expect(sections.length).toBeGreaterThan(30); // the rule must not pass vacuously

    const ungated = sections.filter((dir) => !existsSync(`${dir}/layout.tsx`));
    expect(ungated).toEqual([]);
  });

  /**
   * Authentication is not authorization. Every admin API route names the
   * permission it needs, except three that legitimately cannot:
   */
  const ALLOWED_WITHOUT_PERMISSION = new Set([
    // The login and logout doors themselves — requiring a permission to sign
    // in would be circular.
    "app/api/admin/auth/login/route.ts",
    "app/api/admin/auth/logout/route.ts",
    // Server-to-server, guarded by its own constant-time SYNC_STAGING_KEY
    // rather than by a staff session.
    "app/api/admin/sync-staging/route.ts",
  ]);

  it("every /api/admin route requires a named permission", () => {
    const routes = tracked("'app/api/admin/**/route.ts'");
    expect(routes.length).toBeGreaterThan(100);

    const unguarded = routes.filter((f) => {
      if (ALLOWED_WITHOUT_PERMISSION.has(f)) return false;
      const body = readFileSync(f, "utf8");
      return !/require(Permission|AnyPermission|AnyWritePermission)|getFeesViewer/.test(body);
    });
    expect(unguarded).toEqual([]);
  });
});

describe("security headers", () => {
  /**
   * Asserted by CALLING next.config.mjs, not by grepping it — a string match
   * would pass on a commented-out block. These went live one morning and were
   * gone by noon; this is what notices.
   */
  it("next.config.mjs serves the full header set on every route", async () => {
    const config = (await import("../../next.config.mjs")).default as {
      headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
    };
    const rules = await config.headers();
    const everyRoute = rules.find((r) => r.source === "/(.*)");
    expect(everyRoute, "no header rule matches every route").toBeDefined();

    const keys = new Set(everyRoute!.headers.map((h) => h.key));
    for (const required of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ]) {
      expect(keys, `missing ${required}`).toContain(required);
    }
  });

  it("the enforcing CSP refuses framing and plugin embedding", async () => {
    const config = (await import("../../next.config.mjs")).default as {
      headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
    };
    const rules = await config.headers();
    const csp = rules
      .find((r) => r.source === "/(.*)")!
      .headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe("secrets", () => {
  /**
   * A connection string in source is a connection string in every clone and
   * every backup, for as long as the history exists — deleting the line later
   * does not help. scripts/ still holds 32 of them and is excluded until they
   * are rotated and stripped; shipping code must stay clean from here.
   */
  it("no database connection string is hardcoded in shipping code", () => {
    const files = [
      ...tracked("'app/**/*.ts'"),
      ...tracked("'app/**/*.tsx'"),
      ...tracked("'lib/**/*.ts'"),
      ...tracked("'server/**/*.ts'"),
      ...tracked("'components/**/*.tsx'"),
      ...tracked("'db/*.ts'"),
    ];
    expect(files.length).toBeGreaterThan(500);

    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*")) return; // prose may cite one
          if (/(postgres|postgresql|mysql):\/\/[^\s"'`]+:[^\s"'`@]+@/.test(line)) {
            offenders.push(`${f}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("client / server boundary", () => {
  /**
   * A "use client" module is shipped to the browser. Importing the database
   * client from one is either a build failure or, worse, a leak.
   */
  it("no client component imports the database", () => {
    const files = [...tracked("'components/**/*.tsx'"), ...tracked("'app/**/*.tsx'")];
    const offenders = files.filter((f) => {
      const body = readFileSync(f, "utf8");
      return body.slice(0, 400).includes('"use client"') && /from "@\/db/.test(body);
    });
    expect(offenders).toEqual([]);
  });
});

describe("repository hygiene", () => {
  /**
   * The repo root was cleaned by hand at 10:00 on 2026-09-10 and was dirty
   * again by 12:25, because a deck generator writes .xlsx and .pdf there on
   * every run. Manual cleaning is not a fix. .gitignore now covers the root,
   * and this stops anyone committing past it.
   *
   * Anchored to the ROOT only — docs/guides/*.pdf is a tracked deliverable and
   * must stay that way.
   */
  it("no document or media artefact is tracked at the repository root", () => {
    const rootFiles = tracked("").filter((f) => !f.includes("/"));
    expect(rootFiles.length).toBeGreaterThan(5); // must not pass vacuously

    const junk = rootFiles.filter((f) =>
      /\.(xlsx|xls|pptx|docx|pdf|csv|jpe?g|png|patch|zip|dump|bundle)$/i.test(f),
    );
    expect(junk).toEqual([]);
  });

  it("build output and backups are never tracked", () => {
    const forbidden = tracked("").filter((f) =>
      /^(\.next|node_modules|db_backups|public\.r2-backup)\//.test(f),
    );
    expect(forbidden).toEqual([]);
  });
});

describe("scheduled jobs", () => {
  // Five auth conventions across twelve cron routes is how a token rotation
  // misses one. server/cron-auth.ts is the single door; every route uses it.
  it("every /api/cron route authenticates through requireCron", () => {
    const routes = tracked("'app/api/cron/*/route.ts'");
    expect(routes.length).toBeGreaterThan(0);
    const offenders = routes.filter((f) => {
      const body = readFileSync(f, "utf8");
      return !/requireCron\(/.test(body) || /process\.env\.CRON_(SECRET|KEY)/.test(body);
    });
    expect(offenders, "cron routes not using requireCron / still reading CRON_SECRET|CRON_KEY").toEqual([]);
  });
});
