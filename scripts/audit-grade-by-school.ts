/* eslint-disable no-console */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { mcbGradeToCanonical } from "../lib/mcb/mappings";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  const rows = (await db.execute(sql`
    SELECT sc.school_name, s.grade AS stored, m.grade AS mcb_grade
      FROM students s JOIN mcb_students m ON m.enrolment_number=s.enrollment_number
      LEFT JOIN schools sc ON sc.id=s.school_id
     WHERE m.website_access = true
  `)) as unknown as { school_name: string | null; stored: string | null; mcb_grade: string | null }[];

  type Bucket = { broken: number; correct: number; manual_or_other: number; unparseable: number; total: number };
  const bySchool = new Map<string, Bucket>();
  for (const r of rows) {
    const sch = r.school_name ?? "(unknown)";
    if (!bySchool.has(sch)) bySchool.set(sch, { broken: 0, correct: 0, manual_or_other: 0, unparseable: 0, total: 0 });
    const b = bySchool.get(sch)!;
    b.total++;
    const expected = mcbGradeToCanonical(r.mcb_grade);
    if (!expected) { b.unparseable++; continue; }
    if (r.stored === expected) { b.correct++; continue; }
    // Check if stored matches the broken 1:1 — Grade N where N is the
    // numeric class from MCB (without +3). For pre-primary we don't have a
    // numeric N, so they collapse into "manual_or_other".
    const expectedN = parseInt((expected.match(/^Grade (\d+)$/) ?? [])[1] ?? "", 10);
    if (!Number.isFinite(expectedN)) { b.manual_or_other++; continue; }
    const brokenN = expectedN - 3;
    if (r.stored === `Grade ${brokenN}`) b.broken++;
    else b.manual_or_other++;
  }

  console.log("\nPer-school grade audit\n");
  console.log("School".padEnd(36), "Broken 1:1".padStart(11), "Correct +3".padStart(11), "Manual/other".padStart(13), "Pre-primary".padStart(12), "Total".padStart(7));
  console.log("-".repeat(95));
  for (const [school, b] of Array.from(bySchool.entries()).sort()) {
    console.log(
      school.padEnd(36),
      String(b.broken).padStart(11),
      String(b.correct).padStart(11),
      String(b.manual_or_other).padStart(13),
      String(b.unparseable).padStart(12),
      String(b.total).padStart(7),
    );
  }
  const grand = { broken: 0, correct: 0, manual_or_other: 0, unparseable: 0, total: 0 };
  for (const b of bySchool.values()) {
    grand.broken += b.broken;
    grand.correct += b.correct;
    grand.manual_or_other += b.manual_or_other;
    grand.unparseable += b.unparseable;
    grand.total += b.total;
  }
  console.log("-".repeat(95));
  console.log("TOTAL".padEnd(36),
    String(grand.broken).padStart(11),
    String(grand.correct).padStart(11),
    String(grand.manual_or_other).padStart(13),
    String(grand.unparseable).padStart(12),
    String(grand.total).padStart(7),
  );
  console.log("");
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
