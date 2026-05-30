/* eslint-disable no-console */
/**
 * Merge the 822 student duplicate pairs created when the May-18 admin CSV
 * import stored MCB's StudentReferencesCode in students.enrollment_number,
 * then May-30 MCB grants inserted a parallel row keyed by MCB's canonical
 * enrolment_number.
 *
 * Strategy (full MCB takeover, see /root/.claude/plans/can-we-fetch-the-ancient-bengio.md):
 *   - Keep the OLD row (preserves order/cart history).
 *   - Move orders, cart_items, guardian_links NEW → OLD.
 *   - Delete the NEW row.
 *   - Overwrite OLD with MCB values: enrolment_number, name, first_name,
 *     grade, section, mobile, parent_id, erp_name.
 *   - Find-or-create parents rows for BOTH father and mother phones so
 *     either can OTP-login (visibility is enabled by the parallel
 *     widening in lib/session.ts).
 *   - Insert student_guardian_links for father (rowIdx 0) and mother
 *     (rowIdx 1) — anti-joined against the partial unique
 *     (student_id, right10(phone_no)) to avoid index collision.
 *
 *   npx tsx scripts/merge-mcb-dup-pairs.ts           # dry-run
 *   npx tsx scripts/merge-mcb-dup-pairs.ts --apply   # commit
 */
import { config } from "dotenv";
import path from "path";
import fs from "fs";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";
import { mcbGradeToCbse } from "../lib/mcb/mappings";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;
if (!url) throw new Error("DATABASE_URL required (load .env.deploy or pass DATABASE_URL=…)");
const sql = postgres(url, { max: 1 });

type Pair = {
  old_id: string;
  new_id: string;
  school_id: string;
  school_slug: string;
  mcb_enrol: string;
  mcb_refcode: string;
  mcb_school_name: string;
  mcb_raw: Record<string, unknown>;
  mcb_grade_raw: string | null;
  mcb_section: string | null;
  mcb_student_name: string | null;
  mcb_full_name: string | null;
  old_grade: string | null;
  old_first_name: string | null;
  old_section: string | null;
  old_school_code: string | null;
};

type LogRow = {
  pair: number;
  school: string;
  mcb_enrol: string;
  mcb_refcode: string;
  old_id: string;
  new_id: string;
  action: string;
  detail: string;
};

const last10 = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

async function loadPairs(): Promise<Pair[]> {
  const rows = await sql<Pair[]>`
    SELECT s_old.id            AS old_id,
           s_new.id            AS new_id,
           s_old.school_id     AS school_id,
           sch.slug            AS school_slug,
           m.enrolment_number  AS mcb_enrol,
           s_old.enrollment_number AS mcb_refcode,
           m.school_name       AS mcb_school_name,
           m.raw               AS mcb_raw,
           m.grade             AS mcb_grade_raw,
           m.section           AS mcb_section,
           m.student_name      AS mcb_student_name,
           m.raw->>'FullName'  AS mcb_full_name,
           s_old.grade         AS old_grade,
           s_old.first_name    AS old_first_name,
           s_old.section       AS old_section,
           s_old.school_code   AS old_school_code
      FROM students s_old
      JOIN mcb_students m
        ON m.raw->>'StudentReferencesCode' = s_old.enrollment_number
      JOIN students s_new
        ON s_new.school_id = s_old.school_id
       AND s_new.enrollment_number = m.enrolment_number
      JOIN schools sch ON sch.id = s_old.school_id
     ORDER BY sch.slug, m.enrolment_number
  `;
  return rows;
}

async function findOrCreateParent(
  tx: postgres.TransactionSql,
  phone: string,
  name: string | null,
  email: string | null
): Promise<string> {
  const existing = await tx<{ id: string }[]>`
    SELECT id FROM parents WHERE phone = ${phone} LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO parents (phone, name, email, status, first_time_login)
    VALUES (${phone}, ${name}, ${email}, 'active', true)
    RETURNING id
  `;
  return inserted[0]!.id;
}

async function findOrCreateGuardian(
  tx: postgres.TransactionSql,
  phone: string,
  name: string | null,
  email: string | null
): Promise<string> {
  const existing = await tx<{ id: string }[]>`
    SELECT id FROM guardians
     WHERE right(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'), 10) = ${phone}
     LIMIT 1
  `;
  if (existing[0]) {
    if (name || email) {
      await tx`
        UPDATE guardians
           SET guardian_name = COALESCE(${name}, guardian_name),
               email = COALESCE(${email}, email),
               email_address = COALESCE(${email}, email_address)
         WHERE id = ${existing[0].id}
      `;
    }
    return existing[0].id;
  }
  const erpName = `MCB-G-${phone}`;
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO guardians (erp_name, guardian_name, mobile_number, email, email_address)
    VALUES (${erpName}, ${name}, ${phone}, ${email}, ${email})
    RETURNING id
  `;
  return inserted[0]!.id;
}

async function upsertLink(
  tx: postgres.TransactionSql,
  studentId: string,
  rowIdx: number,
  guardianErpName: string,
  guardianName: string | null,
  relation: string,
  phone: string,
  email: string | null
): Promise<"inserted" | "updated" | "skipped"> {
  // Same-phone link already attached (under any relation)? Update it in place.
  const samePhone = await tx<{ id: string }[]>`
    SELECT id FROM student_guardian_links
     WHERE student_id = ${studentId}
       AND right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${phone}
     LIMIT 1
  `;
  if (samePhone[0]) {
    await tx`
      UPDATE student_guardian_links
         SET guardian_erp_name = ${guardianErpName},
             guardian_name     = COALESCE(${guardianName}, guardian_name),
             relation          = ${relation},
             email             = COALESCE(${email}, email)
       WHERE id = ${samePhone[0].id}
    `;
    return "updated";
  }
  // Avoid colliding with another row at the same row_idx — pick the next free idx.
  const idxRow = await tx<{ next_idx: number }[]>`
    SELECT COALESCE(MAX(row_idx), -1) + 1 AS next_idx
      FROM student_guardian_links WHERE student_id = ${studentId}
  `;
  const insertIdx = Math.max(rowIdx, idxRow[0]?.next_idx ?? 0);
  await tx`
    INSERT INTO student_guardian_links
      (student_id, row_idx, guardian_erp_name, guardian_name, relation, phone_no, email)
    VALUES
      (${studentId}, ${insertIdx}, ${guardianErpName}, ${guardianName}, ${relation}, ${phone}, ${email})
  `;
  return "inserted";
}

async function processPair(
  tx: postgres.TransactionSql,
  p: Pair,
  logs: LogRow[],
  pairIdx: number
): Promise<void> {
  const raw = p.mcb_raw || {};
  const fatherPhone = last10(raw["FatherPhone"]);
  const motherPhone = last10(raw["MotherPhone"]);
  const fatherName = (raw["FatherName"] as string | null) || null;
  const motherName = (raw["MotherName"] as string | null) || null;
  const fatherEmail = (raw["FatherEmailID"] as string | null) || null;
  const motherEmail = (raw["MotherEmailID"] as string | null) || null;

  const usingFather = !!fatherPhone;
  const primaryPhone = usingFather ? fatherPhone! : motherPhone;
  if (!primaryPhone) {
    throw new Error(`pair ${p.mcb_enrol}: no valid father or mother phone in MCB`);
  }
  const primaryName = usingFather ? fatherName : motherName;
  const primaryEmail = usingFather ? fatherEmail : motherEmail;

  const fullName = (p.mcb_full_name || p.mcb_student_name || "").trim();
  if (!fullName) throw new Error(`pair ${p.mcb_enrol}: missing MCB name`);
  const mcbGrade = mcbGradeToCbse(p.mcb_grade_raw);
  if (!mcbGrade) throw new Error(`pair ${p.mcb_enrol}: cannot translate MCB grade ${JSON.stringify(p.mcb_grade_raw)}`);

  // 1. find-or-create parents row for primary (becomes students.parent_id)
  const primaryParentId = await findOrCreateParent(tx, primaryPhone, primaryName, primaryEmail);
  logs.push({
    pair: pairIdx, school: p.school_slug, mcb_enrol: p.mcb_enrol, mcb_refcode: p.mcb_refcode,
    old_id: p.old_id, new_id: p.new_id, action: "parent_primary",
    detail: `${usingFather ? "Father" : "Mother"} phone=${primaryPhone} parent_id=${primaryParentId}`,
  });

  // 1b. find-or-create parents row for the OTHER parent (so both can login)
  if (fatherPhone && motherPhone && fatherPhone !== motherPhone) {
    const secondaryPhone = usingFather ? motherPhone : fatherPhone;
    const secondaryName  = usingFather ? motherName  : fatherName;
    const secondaryEmail = usingFather ? motherEmail : fatherEmail;
    const id = await findOrCreateParent(tx, secondaryPhone, secondaryName, secondaryEmail);
    logs.push({
      pair: pairIdx, school: p.school_slug, mcb_enrol: p.mcb_enrol, mcb_refcode: p.mcb_refcode,
      old_id: p.old_id, new_id: p.new_id, action: "parent_secondary",
      detail: `${usingFather ? "Mother" : "Father"} phone=${secondaryPhone} parent_id=${id}`,
    });
  }

  // 2. Reassign NEW → OLD dependencies BEFORE deleting NEW
  const ordersMoved = await tx`UPDATE orders SET student_id = ${p.old_id} WHERE student_id = ${p.new_id} RETURNING id`;
  const cartsMoved  = await tx`UPDATE cart_items SET student_id = ${p.old_id} WHERE student_id = ${p.new_id} RETURNING id`;
  // student_guardian_links: anti-join — only move rows whose phone isn't
  // already attached to OLD. Identical-phone rows on NEW are dropped (the
  // surviving OLD link already covers them).
  const linksMoved = await tx`
    UPDATE student_guardian_links
       SET student_id = ${p.old_id}
     WHERE student_id = ${p.new_id}
       AND NOT EXISTS (
         SELECT 1 FROM student_guardian_links x
          WHERE x.student_id = ${p.old_id}
            AND right(regexp_replace(coalesce(x.phone_no,''), '\D', '', 'g'), 10)
              = right(regexp_replace(coalesce(student_guardian_links.phone_no,''), '\D', '', 'g'), 10)
       )
     RETURNING id
  `;
  if (ordersMoved.length || cartsMoved.length || linksMoved.length) {
    logs.push({
      pair: pairIdx, school: p.school_slug, mcb_enrol: p.mcb_enrol, mcb_refcode: p.mcb_refcode,
      old_id: p.old_id, new_id: p.new_id, action: "reassign",
      detail: `orders=${ordersMoved.length} carts=${cartsMoved.length} links=${linksMoved.length}`,
    });
  }

  // 3. Delete NEW. FK ON DELETE CASCADE on student_guardian_links wipes the
  // residual same-phone links on NEW that we deliberately didn't move.
  await tx`DELETE FROM students WHERE id = ${p.new_id}`;

  // 4. Full MCB takeover on OLD (now the surviving row).
  const erpName = `MCB-${p.mcb_enrol}`;
  await tx`
    UPDATE students
       SET enrollment_number     = ${p.mcb_enrol},
           name                  = ${fullName},
           first_name            = ${fullName},
           grade                 = ${mcbGrade},
           section               = ${p.mcb_section},
           student_mobile_number = ${primaryPhone},
           parent_id             = ${primaryParentId},
           erp_name              = ${erpName},
           synced_at             = now()
     WHERE id = ${p.old_id}
  `;
  logs.push({
    pair: pairIdx, school: p.school_slug, mcb_enrol: p.mcb_enrol, mcb_refcode: p.mcb_refcode,
    old_id: p.old_id, new_id: p.new_id, action: "students_update",
    detail: `enrol=${p.mcb_enrol} name=${fullName} grade=${mcbGrade} section=${p.mcb_section ?? ""} mobile=${primaryPhone}${
      p.old_grade !== mcbGrade ? ` GRADE_CONFLICT(${p.old_grade}→${mcbGrade})` : ""
    }`,
  });

  // 5. Seed guardian rows + student_guardian_links for father AND mother.
  if (fatherPhone) {
    const gId = await findOrCreateGuardian(tx, fatherPhone, fatherName, fatherEmail);
    const r = await upsertLink(tx, p.old_id, 0, `MCB-G-${fatherPhone}`, fatherName, "Father", fatherPhone, fatherEmail);
    logs.push({
      pair: pairIdx, school: p.school_slug, mcb_enrol: p.mcb_enrol, mcb_refcode: p.mcb_refcode,
      old_id: p.old_id, new_id: p.new_id, action: `link_father_${r}`,
      detail: `phone=${fatherPhone} guardian_id=${gId} name=${fatherName ?? ""}`,
    });
  }
  if (motherPhone && motherPhone !== fatherPhone) {
    const gId = await findOrCreateGuardian(tx, motherPhone, motherName, motherEmail);
    const r = await upsertLink(tx, p.old_id, 1, `MCB-G-${motherPhone}`, motherName, "Mother", motherPhone, motherEmail);
    logs.push({
      pair: pairIdx, school: p.school_slug, mcb_enrol: p.mcb_enrol, mcb_refcode: p.mcb_refcode,
      old_id: p.old_id, new_id: p.new_id, action: `link_mother_${r}`,
      detail: `phone=${motherPhone} guardian_id=${gId} name=${motherName ?? ""}`,
    });
  }
}

function writeCsv(rows: LogRow[], dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const cols: (keyof LogRow)[] = ["pair", "school", "mcb_enrol", "mcb_refcode", "old_id", "new_id", "action", "detail"];
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const bySchool = new Map<string, LogRow[]>();
  for (const r of rows) {
    const arr = bySchool.get(r.school) ?? [];
    arr.push(r);
    bySchool.set(r.school, arr);
  }
  for (const [school, arr] of bySchool) {
    const body = arr.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
    fs.writeFileSync(path.join(dir, `${school}.csv`), `${header}\n${body}\n`);
  }
  const allBody = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  fs.writeFileSync(path.join(dir, "_all.csv"), `${header}\n${allBody}\n`);
}

async function main(): Promise<void> {
  console.log(`\nmerge-mcb-dup-pairs (${APPLY ? "APPLY" : "DRY-RUN"})\n`);
  const pairs = await loadPairs();
  console.log(`  ${pairs.length} pairs to process`);
  const counts: Record<string, number> = {};
  for (const p of pairs) counts[p.school_slug] = (counts[p.school_slug] || 0) + 1;
  for (const [s, n] of Object.entries(counts)) console.log(`    ${s.padEnd(40)} ${n}`);

  const logs: LogRow[] = [];
  let merged = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    try {
      if (APPLY) {
        await sql.begin(async (tx) => {
          await processPair(tx, p, logs, i + 1);
        });
      } else {
        // Dry-run: use a transaction we always roll back.
        await sql.begin(async (tx) => {
          await processPair(tx, p, logs, i + 1);
          throw new Error("__DRYRUN_ROLLBACK__");
        }).catch((e) => {
          if (e?.message !== "__DRYRUN_ROLLBACK__") throw e;
        });
      }
      merged++;
      if ((i + 1) % 50 === 0) console.log(`    …${i + 1}/${pairs.length} done`);
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.school_slug} ${p.mcb_enrol}: ${msg}`);
      console.error(`  ✗ ${p.school_slug} ${p.mcb_enrol}: ${msg}`);
      if (APPLY) break; // first-error stop per plan
    }
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.resolve(process.cwd(), "tmp", `mcb-merge-${stamp}${APPLY ? "" : "-dryrun"}`);
  writeCsv(logs, dir);

  console.log(`\n  merged: ${merged}  failed: ${failed}  log: ${dir}/_all.csv`);
  if (errors.length) {
    console.log(`  first errors:`);
    for (const e of errors.slice(0, 10)) console.log(`    ${e}`);
  }

  await sql.end({ timeout: 5 });
  if (failed && APPLY) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
