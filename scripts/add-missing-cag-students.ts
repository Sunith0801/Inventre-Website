// Phase: insert 6 missing CAG students under CASNIBMCBSE, and move
// 26CAG20365 (Kabir) from TTTNIBM to TTTPN. Single TX.

import postgres from "postgres";

const SCHOOL_CBSE  = "0b82f2f9-7ad7-4a20-9fb0-69771dc485ba"; // CASNIBMCBSE
const SCHOOL_TTTPN = "901dfb90-8266-43b7-af16-9d51d1be4390"; // TTTPN

type NewStudent = {
  enrollment: string;
  firstName: string;
  lastName: string;
  grade: string;
  gender: string | null;
  email: string | null;
  guardianName: string;
  relation: string;
  phone: string;
  schoolCode: string;
  schoolId: string;
};

// "Boy"/"BOy"/"Girl" → Male/Female.
function normGender(g: string): string | null {
  const v = g.trim().toLowerCase();
  if (v === "boy") return "Male";
  if (v === "girl") return "Female";
  return null;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

const RAW = [
  { enrollment: "22CAG20208", name: "Mahi Sharma",                    grade: "Grade 11", gender: "Girl", email: "shruti.sharma88@ymail.com", guardianName: "Shruti Sharma",         relation: "Mother", phone: "8600430008" },
  { enrollment: "26CAG20382", name: "Shasta Dhar",                    grade: "Grade 11", gender: "Girl", email: "himanshu.dhar@gmail.com",   guardianName: "Rinki Dhar",            relation: "Mother", phone: "7259847000" },
  { enrollment: "26CAG20383", name: "Vedant Ravindra Ghule",          grade: "Grade 11", gender: "Boy",  email: "ravindraghuleghule5521@gmail.com", guardianName: "Ravindra Ghule", relation: "Father", phone: "8208431903" },
  { enrollment: "26CAG20384", name: "Ayaan Nisar Ahemad Khan",        grade: "Grade 11", gender: "Boy",  email: "nisark99@yahoo.co.in",      guardianName: "Nisar Ahemad",          relation: "Father", phone: "9545970009" },
  { enrollment: "26CAG20385", name: "Piyush Shankarlal Bhati",        grade: "Grade 11", gender: "Boy",  email: null,                         guardianName: "Shankarlal Bhati",     relation: "Father", phone: "8983259660" },
  { enrollment: "26CAG20386", name: "Laxman Rajendrasingh Rajpurohit",grade: "Grade 8",  gender: "Boy",  email: "dr.rajmetroclinic13@gmail.com", guardianName: "Rajendrasingh",     relation: "Father", phone: "7775066655" },
];

const ROWS: NewStudent[] = RAW.map((r) => {
  const { first, last } = splitName(r.name);
  return {
    enrollment: r.enrollment,
    firstName: first,
    lastName: last,
    grade: r.grade,
    gender: normGender(r.gender),
    email: r.email,
    guardianName: r.guardianName,
    relation: r.relation,
    phone: r.phone,
    schoolCode: "CASNIBMCBSE",
    schoolId: SCHOOL_CBSE,
  };
});

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const sql = postgres(url, { prepare: false });

  let inserted = 0;
  let skipped  = 0;
  let movedKabir = 0;
  const log: string[] = [];

  await sql.begin(async (tx) => {
    // 1) Move Kabir to TTTPN.
    const kabir = await tx`
      UPDATE students
         SET school_id = ${SCHOOL_TTTPN}, school_code = 'TTTPN'
       WHERE enrollment_number = '26CAG20365'
         AND school_id <> ${SCHOOL_TTTPN}
      RETURNING id
    `;
    movedKabir = kabir.count;

    // 2) Insert the 6.
    for (const r of ROWS) {
      const dup = await tx`
        SELECT id FROM students
         WHERE school_id = ${r.schoolId}
           AND enrollment_number = ${r.enrollment}
         LIMIT 1
      `;
      if (dup.count > 0) {
        skipped++;
        log.push(`SKIP  ${r.enrollment} already exists`);
        continue;
      }

      await tx`
        INSERT INTO parents (phone, name, email)
        VALUES (${r.phone}, ${r.guardianName}, ${r.email})
        ON CONFLICT (phone) DO NOTHING
      `;
      const parentRow = await tx<{ id: string }[]>`
        SELECT id FROM parents WHERE phone = ${r.phone} LIMIT 1
      `;
      const parentId = parentRow[0].id;

      const studentRow = await tx<{ id: string }[]>`
        INSERT INTO students (
          school_id, parent_id, name, first_name, last_name,
          grade, gender, enrollment_number, school_code,
          student_email_id, status
        ) VALUES (
          ${r.schoolId}, ${parentId},
          ${`${r.firstName} ${r.lastName}`.replace(/\s+/g, " ").trim()},
          ${r.firstName}, ${r.lastName},
          ${r.grade}, ${r.gender},
          ${r.enrollment}, ${r.schoolCode},
          ${r.email}, 'active'
        )
        RETURNING id
      `;
      const studentId = studentRow[0].id;

      await tx`
        INSERT INTO student_guardian_links (
          student_id, row_idx, guardian_name, relation, email, phone_no
        ) VALUES (
          ${studentId}, 1, ${r.guardianName}, ${r.relation}, ${r.email}, ${r.phone}
        )
      `;

      inserted++;
      log.push(`OK    ${r.enrollment.padEnd(12)} ${r.firstName} ${r.lastName} (${r.grade})`);
    }
  });

  for (const line of log) console.log(line);
  console.log("\n=== DONE ===");
  console.log(`Kabir moved to TTTPN:  ${movedKabir}`);
  console.log(`Inserted:              ${inserted}`);
  console.log(`Skipped (already in):  ${skipped}`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
