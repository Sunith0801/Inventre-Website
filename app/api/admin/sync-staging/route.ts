import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";

const SCRIPT = path.join(process.cwd(), "scripts/sync-staging.sh");
const LOG_FILE = "/tmp/sync-staging.log";
const LOCK_FILE = "/tmp/sync-staging.lock";

function checkKey(req: Request): boolean {
  const expected = process.env.SYNC_STAGING_KEY;
  if (!expected) return false;
  const auth = req.headers.get("x-sync-key") ?? req.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : auth;
  return provided === expected;
}

// POST /api/admin/sync-staging — trigger a full prod→staging sync
export async function POST(req: Request) {
  if (!checkKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prodDbUrl = process.env.DATABASE_DIRECT_URL;
  if (!prodDbUrl) {
    return NextResponse.json(
      { error: "DATABASE_DIRECT_URL not configured on this instance" },
      { status: 503 }
    );
  }

  const child = spawn(SCRIPT, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PROD_DB_URL: prodDbUrl,
      STAGING_DB_URL: "postgres://inventre:inventre_dev@localhost:6533/inventre_staging",
      PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    },
  });
  child.unref();

  return NextResponse.json({
    ok: true,
    started: true,
    pid: child.pid,
    logFile: LOG_FILE,
    statusUrl: "/api/admin/sync-staging",
  });
}

// GET /api/admin/sync-staging — return sync status + last 80 log lines
export async function GET(req: Request) {
  if (!checkKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let log = "";
  let running = false;

  try {
    const raw = await readFile(LOG_FILE, "utf8");
    const lines = raw.trim().split("\n");
    log = lines.slice(-80).join("\n");
  } catch {
    log = "(no log yet)";
  }

  try {
    const pidStr = await readFile(LOCK_FILE, "utf8");
    const pid = parseInt(pidStr.trim(), 10);
    // Kill 0 = check existence without actually killing
    process.kill(pid, 0);
    running = true;
  } catch {
    running = false;
  }

  const done = log.includes("sync-staging finished");
  const failed = !running && !done && log.length > 0;

  return NextResponse.json({ running, done, failed, log });
}
