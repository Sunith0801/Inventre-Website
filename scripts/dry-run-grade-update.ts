// Dry-run: for each pasted enrollment number, look up the matching student in
// `students` and report current grade vs proposed grade. No writes.
//
// Fallbacks: pad numeric tail to 4 digits, fix `TTPNOO` → `TTTPN00`.

import postgres from "postgres";

type Row = { raw: string; grade: string };

const RAW: Row[] = [
  ["26TTTPN005", "Grade 1"],
  ["26TTTPN003", "Grade 1"],
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

// Generate fallback candidates for an enrollment number.
function candidates(raw: string): string[] {
  const set = new Set<string>([raw]);

  // Normalise OCR'd `OO` (letter O) → `00` (digit zero).
  const ocrFixed = raw.replace(/OO/g, "00");
  set.add(ocrFixed);

  // Fix `TTPN` → `TTTPN` (missing T).
  const ttpnFixed = ocrFixed.replace(/^(\d+)TTPN/, "$1TTTPN");
  set.add(ttpnFixed);

  // Pad numeric tail to 4 digits if shorter.
  for (const v of [...set]) {
    const m = v.match(/^(\d+)([A-Z]+)(\d+)$/);
    if (m) {
      const [, year, school, num] = m;
      if (num.length < 4) {
        set.add(`${year}${school}${num.padStart(4, "0")}`);
      }
    }
  }

  return [...set];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const sql = postgres(url, { prepare: false });

  const found: Array<{
    raw: string;
    matched: string;
    name: string;
    currentGrade: string | null;
    proposedGrade: string;
    changes: boolean;
  }> = [];
  const missing: Array<{ raw: string; triedAll: string[] }> = [];

  for (const { raw, grade } of RAW) {
    const tried = candidates(raw);
    let hit: { enrollment_number: string; name: string; grade: string | null } | null = null;
    for (const c of tried) {
      const rows = await sql<
        { enrollment_number: string; name: string; grade: string | null }[]
      >`SELECT enrollment_number, name, grade FROM students WHERE enrollment_number = ${c} LIMIT 1`;
      if (rows.length) {
        hit = rows[0];
        break;
      }
    }
    if (hit) {
      found.push({
        raw,
        matched: hit.enrollment_number,
        name: hit.name,
        currentGrade: hit.grade,
        proposedGrade: grade,
        changes: (hit.grade ?? "") !== grade,
      });
    } else {
      missing.push({ raw, triedAll: tried });
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Pasted rows:       ${RAW.length}`);
  console.log(`Matched in DB:     ${found.length}`);
  console.log(`NOT found:         ${missing.length}`);
  console.log(`Would change:      ${found.filter((f) => f.changes).length}`);
  console.log(`Already correct:   ${found.filter((f) => !f.changes).length}`);

  console.log("\n=== WOULD CHANGE ===");
  for (const f of found.filter((x) => x.changes)) {
    const matchedNote = f.matched !== f.raw ? ` (via fallback → ${f.matched})` : "";
    console.log(
      `  ${f.raw.padEnd(14)} ${f.name.padEnd(28)} ${String(f.currentGrade).padEnd(12)} → ${f.proposedGrade}${matchedNote}`,
    );
  }

  console.log("\n=== ALREADY CORRECT ===");
  for (const f of found.filter((x) => !x.changes)) {
    console.log(`  ${f.raw.padEnd(14)} ${f.name.padEnd(28)} ${f.currentGrade}`);
  }

  console.log("\n=== NOT FOUND ===");
  for (const m of missing) {
    console.log(`  ${m.raw.padEnd(14)} (tried: ${m.triedAll.join(", ")})`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
