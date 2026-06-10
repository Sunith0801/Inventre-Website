// Phase A: update students.grade per pasted roster, and fix 3 typo
// enrollment numbers (26TTPNOO{1,2,6} → 26TTTPN00{1,2,6}). All in one TX.
//
// Match logic mirrors dry-run-grade-update.ts. Re-runs are idempotent.

import postgres from "postgres";

type Row = { raw: string; grade: string };

const RAW: Row[] = [
  ["26TTTPN005", "Grade 1"], ["26TTTPN003", "Grade 1"],
  ["25TTT01", "Grade 1"], ["25TTT02", "Grade 1"], ["25TTT03", "Grade 1"],
  ["25TTT04", "Grade 1"], ["25TTT05", "Grade 1"], ["25TTT06", "Grade 1"],
  ["25TTT07", "Grade 1"], ["25TTT08", "Grade 1"], ["25TTT09", "Grade 1"],
  ["25TTT10", "Grade 1"], ["25TTT11", "Grade 1"], ["25TTT12", "Grade 1"],
  ["25TTT13", "Grade 1"], ["25TTT14", "Grade 1"], ["25TTT15", "Grade 1"],
  ["25TTT16", "Grade 1"], ["25TTT17", "Grade 1"], ["25TTT18", "Grade 1"],
  ["25TTT19", "Grade 1"], ["25TTT20", "Grade 1"], ["25TTT21", "Grade 1"],
  ["25TTT22", "Grade 1"], ["25TTT23", "Grade 1"], ["25TTT24", "Grade 1"],
  ["25TTT25", "Grade 1"], ["25TTT26", "Grade 1"], ["25TTT27", "Grade 1"],
  ["25TTT28", "Grade 1"], ["25TTT29", "Grade 1"], ["25TTT30", "Grade 1"],
  ["26TTPNOO1", "Grade 2"], ["26TTPNOO2", "Grade 2"], ["26TTPNOO6", "Grade 2"],
  ["25TTT31", "Grade 2"], ["25TTT32", "Grade 2"], ["25TTT33", "Grade 2"],
  ["25TTT34", "Grade 2"], ["25TTT35", "Grade 2"], ["25TTT36", "Grade 2"],
  ["25TTT37", "Grade 2"], ["25TTT38", "Grade 2"], ["25TTT39", "Grade 2"],
  ["25TTT40", "Grade 2"], ["25TTT41", "Grade 2"], ["25TTT42", "Grade 2"],
  ["25TTT43", "Grade 2"], ["25TTT44", "Grade 2"], ["25TTT45", "Grade 2"],
  ["25TTT46", "Grade 2"], ["25TTT47", "Grade 2"], ["25TTT48", "Grade 2"],
  ["25TTT49", "Grade 2"], ["25TTT50", "Grade 2"], ["25TTT51", "Grade 2"],
  ["25TTT52", "Grade 2"], ["25TTT53", "Grade 2"], ["25TTT54", "Grade 2"],
  ["25TTT55", "Grade 2"], ["25TTT56", "Grade 2"], ["25TTT57", "Grade 2"],
  ["25TTT58", "Grade 2"], ["25TTT59", "Grade 2"], ["25TTT60", "Grade 2"],
  ["25TTT61", "Grade 2"], ["25TTT62", "Grade 2"],
  ["25TTT63", "Grade 3"], ["25TTT64", "Grade 3"], ["25TTT65", "Grade 3"],
  ["25TTT66", "Grade 3"], ["25TTT67", "Grade 3"], ["25TTT68", "Grade 3"],
  ["25TTT69", "Grade 3"], ["25TTT70", "Grade 3"], ["25TTT71", "Grade 3"],
  ["25TTT72", "Grade 3"], ["25TTT73", "Grade 3"], ["25TTT74", "Grade 3"],
  ["25TTT75", "Grade 3"], ["25TTT76", "Grade 3"], ["25TTT77", "Grade 3"],
  ["25TTT78", "Grade 3"], ["25TTT79", "Grade 3"], ["25TTT80", "Grade 3"],
  ["25TTT81", "Grade 3"], ["25TTT82", "Grade 3"], ["25TTT83", "Grade 3"],
  ["26TTTPN006", "Nursery"], ["26TTTPN007", "Nursery"], ["26TTTPN008", "Nursery"],
  ["26TTTPN009", "Nursery"], ["26TTTPN0010", "Nursery"], ["26TTTPN0011", "Nursery"],
  ["25TTTPN0076", "Playgroup"], ["25TTTPN0073", "Playgroup"],
  ["25TTTPN0012", "LKG"], ["26TTTPN0013", "Nursery"], ["26TTTPN0014", "Nursery"],
  ["25TTTPN0042", "Nursery"], ["25TTTPN0013", "LKG"], ["26TTTPN0011", "Nursery"],
  ["25TTTPN0062", "LKG"], ["24TTTPN0027", "UKG"], ["26TTTPN0017", "UKG"],
  ["25TTTPN0040", "Nursery"], ["26TTTPN0018", "UKG"], ["26TTTPN0021", "LKG"],
  ["26TTTPN0020", "Nursery"], ["26TTTPN0026", "Nursery"], ["25TTTPN0005", "LKG"],
  ["25TTTPN0003", "Nursery"], ["25TTTPN0032", "LKG"], ["26TTTPN0023", "LKG"],
  ["26TTTPN0033", "LKG"], ["26TTTPN0025", "Nursery"], ["26TTTPN0035", "Nursery"],
  ["25TTTPN0045", "Nursery"], ["26TTTPN0037", "Nursery"], ["25TTTPN0035", "Nursery"],
  ["26TTTPN0041", "LKG"], ["26TTTPN0040", "Nursery"], ["25TTTPN0036", "Nursery"],
  ["26TTTPN0036", "Nursery"],
].map(([raw, grade]) => ({ raw, grade }));

// Typo enrollments to rename. Must run BEFORE grade update so the grade
// update finds them under their new (correct) enrollment number.
const RENAMES: Array<{ from: string; to: string }> = [
  { from: "26TTPNOO1", to: "26TTTPN001" },
  { from: "26TTPNOO2", to: "26TTTPN002" },
  // 26TTPNOO6 (Rew, Grade 2) NOT renamed: target 26TTTPN006 already
  // exists as a different student (Rewa, Nursery) with same guardian phone.
  // Needs user adjudication. Grade still gets bumped under the typo enrollment.
];

// Apply the rename to the in-memory roster too, so the grade update targets
// the new enrollment number.
const renameMap = new Map(RENAMES.map((r) => [r.from, r.to]));
const ROSTER = RAW.map((r) => ({
  raw: renameMap.get(r.raw) ?? r.raw,
  grade: r.grade,
}));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const sql = postgres(url, { prepare: false });

  let renamed = 0;
  let updated = 0;
  let unchanged = 0;
  let missing: string[] = [];

  await sql.begin(async (tx) => {
    for (const { from, to } of RENAMES) {
      const r = await tx`
        UPDATE students
           SET enrollment_number = ${to}
         WHERE enrollment_number = ${from}
        RETURNING id
      `;
      renamed += r.count;
    }

    for (const { raw, grade } of ROSTER) {
      const r = await tx<{ before: string | null }[]>`
        UPDATE students
           SET grade = ${grade}
         WHERE enrollment_number = ${raw}
           AND (grade IS DISTINCT FROM ${grade})
        RETURNING grade AS before
      `;
      if (r.count > 0) {
        updated += r.count;
      } else {
        const exists = await tx`
          SELECT 1 FROM students WHERE enrollment_number = ${raw} LIMIT 1
        `;
        if (exists.count > 0) unchanged++;
        else missing.push(raw);
      }
    }
  });

  console.log("=== APPLIED ===");
  console.log(`Renamed enrollments: ${renamed}`);
  console.log(`Grades updated:      ${updated}`);
  console.log(`Already correct:     ${unchanged}`);
  console.log(`Not found:           ${missing.length}`);
  if (missing.length) {
    console.log("Missing list:");
    for (const m of missing) console.log(`  ${m}`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
