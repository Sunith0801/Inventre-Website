/**
 * Roster import for Samyuktha (SIS), Quantum Leap (QLS), Kidlink (KDL/KIS/IKL/KLI/KLP).
 *
 * Reads three TSV files from scripts/data/roster-2026/ and:
 *   1. Upserts students (insert new, update grade/email/gender on existing) keyed by
 *      (school_id, enrollment_number).
 *   2. Inserts canonical `guardians` rows for any new phones (anti-join on
 *      last10(mobile_number) partial unique index).
 *   3. Appends `student_guardian_links` rows for any new (student, phone) pairs
 *      (anti-join on the same student_guardian_links_unique_phone partial index).
 *      The `sgl_reparent_after_change_trg` trigger auto-links siblings via
 *      `students.parent_id` when a shared `parents` row exists.
 *
 * Dry-run by default; pass --commit to apply.
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *     npx tsx scripts/import-roster-sis-qls-kidlink.ts            # dry-run
 *   DATABASE_URL=... npx tsx scripts/import-roster-sis-qls-kidlink.ts --commit
 */

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Set DATABASE_URL");
  process.exit(1);
}
const COMMIT = process.argv.includes("--commit");

const SCHOOL_IDS = {
  samyu: "1a5f24e7-406b-4a74-be99-2b04a7eb74cf",
  qls: "c84967f9-35b0-415b-86a8-cb7638957931",
  kidlink: "6bec4eea-264e-4d89-ba7b-01068f038031",
} as const;

// schools.school_code — also stored on students.school_code; the admin UI
// School dropdown reads from students.school_code, so it must be set.
const SCHOOL_CODES: Record<string, string> = {
  [SCHOOL_IDS.samyu]: "SAMYU",
  [SCHOOL_IDS.qls]: "QLPHP",
  [SCHOOL_IDS.kidlink]: "KLINK",
};

const DATA_DIR = path.join(__dirname, "data", "roster-2026");

const PLACEHOLDER_EMAILS = new Set([
  "no@gmail.com",
  "abc@gmail.com",
  "123@gmail.com",
  "day scholar",
  "",
]);
const PLACEHOLDER_NAMES = new Set(["father", "mother", "0", ""]);

type Guardian = {
  name: string | null;
  phone: string; // raw
  phone10: string | null; // last 10 digits, or null if not 10
  email: string | null;
  relation: "Father" | "Mother";
};

type Row = {
  school_id: string;
  enrollment: string;
  name: string | null;
  grade: string | null;
  gender: string | null;
  // first non-empty real guardian email — candidate for student_email_id fill
  primary_email: string | null;
  guardians: Guardian[];
};

// ── helpers ──────────────────────────────────────────────────────────────
const last10 = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const digits = String(s).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
};

const cleanStr = (s: string | null | undefined): string | null => {
  if (s == null) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
};

const realEmail = (s: string | null | undefined): string | null => {
  const c = cleanStr(s);
  if (!c) return null;
  const low = c.toLowerCase();
  if (PLACEHOLDER_EMAILS.has(low)) return null;
  if (!c.includes("@")) return null;
  return c;
};

const realName = (s: string | null | undefined): string | null => {
  const c = cleanStr(s);
  if (!c) return null;
  if (PLACEHOLDER_NAMES.has(c.toLowerCase())) return null;
  return c;
};

const normGrade = (g: string | null | undefined): string | null => {
  const c = cleanStr(g);
  if (!c) return null;
  const u = c.toUpperCase();
  if (u === "NURSERY" || u === "NURSARY") return "Nursery";
  if (u === "LKG") return "LKG";
  if (u === "UKG") return "UKG";
  const m = /^GRADE\s*(\d+)$/i.exec(c);
  if (m) return `Grade ${m[1]}`;
  return c;
};

const normGender = (g: string | null | undefined): string | null => {
  const c = cleanStr(g);
  if (!c) return null;
  const u = c.toLowerCase();
  if (u.startsWith("b") || u.startsWith("m")) return "Male";
  if (u.startsWith("g") || u.startsWith("f")) return "Female";
  return null;
};

function readTsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (cells[i] ?? "").trim();
    });
    return o;
  });
}

// ── row builders ─────────────────────────────────────────────────────────
function buildSamyuktha(): Row[] {
  const rows = readTsv(path.join(DATA_DIR, "samyuktha.tsv"));
  return rows.map((r) => {
    const guardians: Guardian[] = [];
    const fp = last10(r.father_mobile);
    const fname = realName(r.father_name);
    if (fp) {
      guardians.push({
        name: fname,
        phone: r.father_mobile.trim(),
        phone10: fp,
        email: realEmail(r.father_email),
        relation: "Father",
      });
    }
    const mp = last10(r.mother_mobile);
    const mname = realName(r.mother_name);
    if (mp) {
      guardians.push({
        name: mname,
        phone: r.mother_mobile.trim(),
        phone10: mp,
        email: realEmail(r.mother_email),
        relation: "Mother",
      });
    }
    const primary_email =
      guardians.find((g) => g.email)?.email ?? null;
    return {
      school_id: SCHOOL_IDS.samyu,
      enrollment: r.enrollment.trim(),
      name: cleanStr(r.name),
      grade: normGrade(r.grade),
      gender: normGender(r.gender),
      primary_email,
      guardians,
    };
  });
}

function buildQuantumLeap(): Row[] {
  const rows = readTsv(path.join(DATA_DIR, "quantum-leap.tsv"));
  return rows.map((r) => {
    const guardians: Guardian[] = [];
    const fp = last10(r.father_mobile);
    const fname = realName(r.father_name);
    if (fp) {
      guardians.push({
        name: fname,
        phone: r.father_mobile.trim(),
        phone10: fp,
        email: realEmail(r.parent_email),
        relation: "Father",
      });
    }
    const primary_email = guardians.find((g) => g.email)?.email ?? null;
    return {
      school_id: SCHOOL_IDS.qls,
      enrollment: r.enrollment.trim(),
      name: cleanStr(r.name),
      grade: normGrade(r.grade),
      gender: normGender(r.gender),
      primary_email,
      guardians,
    };
  });
}

function buildKidlink(): Row[] {
  const rows = readTsv(path.join(DATA_DIR, "kidlink.tsv"));
  return rows.map((r) => {
    const fullName = [r.first_name, r.middle_name, r.last_name]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const guardians: Guardian[] = [];
    const gp = last10(r.guardian_phone);
    const gname = realName(r.guardian_name);
    if (gp) {
      const rel =
        cleanStr(r.guardian_relation)?.toLowerCase() === "mother"
          ? "Mother"
          : "Father";
      guardians.push({
        name: gname,
        phone: r.guardian_phone.trim(),
        phone10: gp,
        email: realEmail(r.guardian_email),
        relation: rel,
      });
    }
    const studentEmail = realEmail(r.student_email);
    const primary_email = studentEmail ?? guardians.find((g) => g.email)?.email ?? null;
    return {
      school_id: SCHOOL_IDS.kidlink,
      enrollment: r.enrollment.trim(),
      name: fullName || null,
      grade: normGrade(r.grade),
      gender: normGender(r.gender),
      primary_email,
      guardians,
    };
  });
}

// ── dedupe (last occurrence wins per (school_id, enrollment)) ───────────
function dedupe(rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const r of rows) {
    map.set(`${r.school_id}|${r.enrollment}`, r);
  }
  return [...map.values()];
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  const sql = postgres(DATABASE_URL!, { max: 4 });

  const rows = dedupe([
    ...buildSamyuktha(),
    ...buildQuantumLeap(),
    ...buildKidlink(),
  ]);
  console.log(`[roster] parsed ${rows.length} unique (school, enrollment) rows`);

  // Load existing students for these enrollments per school.
  const existingByKey = new Map<string, {
    id: string;
    name: string | null;
    grade: string | null;
    gender: string | null;
    student_email_id: string | null;
  }>();

  for (const schoolId of Object.values(SCHOOL_IDS)) {
    const enrols = rows.filter((r) => r.school_id === schoolId).map((r) => r.enrollment);
    if (enrols.length === 0) continue;
    const found = await sql<
      { id: string; enrollment_number: string; name: string | null; grade: string | null; gender: string | null; student_email_id: string | null }[]
    >`
      SELECT id, enrollment_number, name, grade, gender, student_email_id
      FROM students
      WHERE school_id = ${schoolId} AND enrollment_number = ANY(${enrols})
    `;
    for (const f of found) {
      existingByKey.set(`${schoolId}|${f.enrollment_number}`, f);
    }
  }

  type Plan = {
    row: Row;
    action: "insert" | "update" | "noop";
    update_fields: string[];
    student_id?: string;
  };
  const plans: Plan[] = [];

  for (const r of rows) {
    const ex = existingByKey.get(`${r.school_id}|${r.enrollment}`);
    if (!ex) {
      plans.push({ row: r, action: "insert", update_fields: [] });
      continue;
    }
    const updates: string[] = [];
    // grade: normalize DB side too for fair compare
    if (r.grade && normGrade(ex.grade) !== r.grade) updates.push(`grade(${ex.grade}→${r.grade})`);
    // name: only fill blank/placeholder DB names
    const dbNameClean = realName(ex.name);
    if (r.name && !dbNameClean) updates.push("name(blank→set)");
    // gender: fill if NULL
    if (r.gender && !ex.gender) updates.push("gender(blank→set)");
    // email: replace placeholders only
    const dbEmail = ex.student_email_id;
    const dbEmailIsPlaceholder = !dbEmail || PLACEHOLDER_EMAILS.has(dbEmail.toLowerCase());
    if (r.primary_email && dbEmailIsPlaceholder && dbEmail !== r.primary_email) {
      updates.push(`email(${dbEmail ?? "null"}→${r.primary_email})`);
    }
    plans.push({
      row: r,
      action: updates.length ? "update" : "noop",
      update_fields: updates,
      student_id: ex.id,
    });
  }

  const inserts = plans.filter((p) => p.action === "insert");
  const updates = plans.filter((p) => p.action === "update");
  const noops = plans.filter((p) => p.action === "noop");

  console.log(`[roster] students: insert=${inserts.length} update=${updates.length} noop=${noops.length}`);
  for (const p of inserts) {
    console.log(`  INSERT ${p.row.school_id.slice(0, 8)} ${p.row.enrollment}  ${p.row.name} [${p.row.grade}]`);
  }
  for (const p of updates) {
    console.log(`  UPDATE ${p.row.enrollment}  ${p.update_fields.join(", ")}`);
  }

  // Guardian preview: count distinct phones we'd add and how many sibling clusters appear.
  const phoneToStudents = new Map<string, { enrollment: string; school: string; name: string | null }[]>();
  for (const p of plans) {
    for (const g of p.row.guardians) {
      if (!g.phone10) continue;
      const arr = phoneToStudents.get(g.phone10) ?? [];
      arr.push({ enrollment: p.row.enrollment, school: p.row.school_id, name: p.row.name });
      phoneToStudents.set(g.phone10, arr);
    }
  }
  const siblingClusters = [...phoneToStudents.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`[roster] guardian phones in paste: ${phoneToStudents.size}; sibling clusters (>=2 students share phone): ${siblingClusters.length}`);
  for (const [phone, arr] of siblingClusters) {
    console.log(`  SIBLINGS ${phone} → ${arr.map((a) => `${a.enrollment}${a.name ? ` (${a.name.slice(0, 20)})` : ""}`).join(" + ")}`);
  }

  if (!COMMIT) {
    console.log("[roster] DRY RUN. Re-run with --commit to apply.");
    await sql.end({ timeout: 5 });
    return;
  }

  // ── COMMIT ─────────────────────────────────────────────────────────────
  await sql.begin(async (tx) => {
    // 1. Inserts.
    for (const p of inserts) {
      const r = p.row;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO students (
          school_id, school_code, enrollment_number, name, first_name, grade, gender, student_email_id, status, enabled
        ) VALUES (
          ${r.school_id}, ${SCHOOL_CODES[r.school_id]}, ${r.enrollment}, ${r.name ?? ""}, ${r.name ?? ""}, ${r.grade}, ${r.gender},
          ${r.primary_email}, 'active', true
        )
        ON CONFLICT (school_id, enrollment_number) WHERE enrollment_number IS NOT NULL
          DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) {
        // Race: was already there. Pick up the id.
        const got = await tx<{ id: string }[]>`
          SELECT id FROM students WHERE school_id = ${r.school_id} AND enrollment_number = ${r.enrollment}
        `;
        if (got[0]) p.student_id = got[0].id;
      } else {
        p.student_id = inserted[0].id;
      }
    }

    // 2. Updates (field-by-field; only the fields flagged in dry-run logic).
    for (const p of updates) {
      const r = p.row;
      const ex = existingByKey.get(`${r.school_id}|${r.enrollment}`)!;
      const newGrade = p.update_fields.some((f) => f.startsWith("grade(")) ? r.grade : ex.grade;
      const newName = p.update_fields.includes("name(blank→set)") ? r.name : ex.name;
      const newGender = p.update_fields.includes("gender(blank→set)") ? r.gender : ex.gender;
      const newEmail = p.update_fields.some((f) => f.startsWith("email(")) ? r.primary_email : ex.student_email_id;
      await tx`
        UPDATE students SET
          grade = ${newGrade},
          name = ${newName ?? ""},
          gender = ${newGender},
          student_email_id = ${newEmail}
        WHERE id = ${ex.id}
      `;
    }

    // 3. Canonical guardians upsert (anti-join, partial index).
    type GuardianInput = { phone: string; name: string | null; email: string | null };
    const guardianMap = new Map<string, GuardianInput>();
    for (const p of plans) {
      for (const g of p.row.guardians) {
        if (!g.phone10) continue;
        const prev = guardianMap.get(g.phone10);
        if (!prev) {
          guardianMap.set(g.phone10, { phone: g.phone10, name: g.name, email: g.email });
        } else {
          // prefer a non-null name/email
          if (!prev.name && g.name) prev.name = g.name;
          if (!prev.email && g.email) prev.email = g.email;
        }
      }
    }
    const guardiansArr = [...guardianMap.values()];
    if (guardiansArr.length > 0) {
      const inserted = await tx`
        WITH input AS (
          SELECT *
          FROM (VALUES ${tx(guardiansArr.map((g) => [g.phone, g.name, g.email]))}) AS v(phone, name, email)
        )
        INSERT INTO guardians (erp_name, guardian_name, mobile_number, email, email_address)
        SELECT 'ROSTER-G-' || i.phone, i.name, i.phone, i.email, i.email
        FROM input i
        LEFT JOIN guardians g
          ON right(regexp_replace(coalesce(g.mobile_number,''), '\D','','g'), 10) = i.phone
        WHERE g.id IS NULL
        RETURNING 1
      `;
      console.log(`[roster] guardians inserted: ${inserted.length}`);
    }

    // 4. Student-guardian links — anti-join on (student_id, last10(phone_no)).
    type LinkInput = {
      student_id: string;
      phone: string; // raw
      name: string | null;
      email: string | null;
      relation: string;
    };
    const linkInputs: LinkInput[] = [];
    for (const p of plans) {
      if (!p.student_id) continue;
      for (const g of p.row.guardians) {
        if (!g.phone10) continue;
        linkInputs.push({
          student_id: p.student_id,
          phone: g.phone,
          name: g.name,
          email: g.email,
          relation: g.relation,
        });
      }
    }
    if (linkInputs.length > 0) {
      const inserted = await tx`
        WITH input AS (
          SELECT *
          FROM (VALUES ${tx(linkInputs.map((l) => [l.student_id, l.phone, l.name, l.email, l.relation]))})
            AS v(student_id, phone, name, email, relation)
        ),
        new_pairs AS (
          SELECT i.student_id::uuid, i.phone, i.name, i.email, i.relation,
                 right(regexp_replace(coalesce(i.phone,''), '\D','','g'), 10) AS phone10
          FROM input i
          WHERE length(right(regexp_replace(coalesce(i.phone,''), '\D','','g'), 10)) = 10
        ),
        missing AS (
          SELECT DISTINCT ON (n.student_id, n.phone10)
                 n.student_id, n.phone, n.name, n.email, n.relation, n.phone10
          FROM new_pairs n
          LEFT JOIN student_guardian_links e
            ON e.student_id = n.student_id
           AND right(regexp_replace(coalesce(e.phone_no,''), '\D','','g'), 10) = n.phone10
          WHERE e.id IS NULL
          ORDER BY n.student_id, n.phone10, n.relation
        ),
        next_idx AS (
          SELECT s.id AS student_id,
                 COALESCE(MAX(l.row_idx), -1) + 1 AS next_row
          FROM students s
          LEFT JOIN student_guardian_links l ON l.student_id = s.id
          WHERE s.id IN (SELECT student_id FROM missing)
          GROUP BY s.id
        )
        INSERT INTO student_guardian_links (student_id, row_idx, guardian_erp_name, guardian_name, relation, phone_no, email)
        SELECT m.student_id,
               n.next_row + (ROW_NUMBER() OVER (PARTITION BY m.student_id ORDER BY m.relation)) - 1,
               'ROSTER-G-' || m.phone10,
               m.name,
               m.relation,
               m.phone,
               m.email
        FROM missing m
        JOIN next_idx n USING (student_id)
        RETURNING 1
      `;
      console.log(`[roster] student_guardian_links inserted: ${inserted.length}`);
    }
  });

  console.log("[roster] COMMIT complete.");
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
