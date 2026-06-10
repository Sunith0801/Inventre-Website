// Phase B: insert the 20 missing TTTPN students with parent + guardian link.
//
// Per row:
//   1. parents: lookup by phone (digits-only); INSERT ... ON CONFLICT (phone) DO NOTHING.
//   2. students: INSERT under school TTTPN, link to parent.
//   3. student_guardian_links: INSERT one row per student.
//
// Idempotent: if a student row already exists for (school_id, enrollment_number)
// we skip the whole row.

import postgres from "postgres";

const TTTPN_SCHOOL_ID = "901dfb90-8266-43b7-af16-9d51d1be4390";

type NewStudent = {
  enrollment: string;
  firstName: string;
  lastName: string;
  grade: string;
  gender: string | null;
  section: string;
  guardianName: string;
  relation: string;
  email: string;
  phone: string;
  altPhone: string | null;
};

const ROWS: NewStudent[] = [
  // Grade 1 missing (5)
  { enrollment: "25TTT02", firstName: "Ayush", lastName: "Kamthe", grade: "Grade 1", gender: "Male", section: "A", guardianName: "Krishna Kamthe", relation: "Father", email: "krishna.kamthe18@gmail.com", phone: "9921321999", altPhone: "8275273822" },
  { enrollment: "25TTT04", firstName: "Aira", lastName: "Baisane", grade: "Grade 1", gender: "Female", section: "A", guardianName: "Amey Baisane", relation: "Father", email: "amey.baisane@gmail.com", phone: "7405785668", altPhone: "9503102999" },
  { enrollment: "25TTT05", firstName: "Prisha", lastName: "Vyas", grade: "Grade 1", gender: "Female", section: "A", guardianName: "Prashanr Vyas", relation: "Father", email: "vyasprashant90@gmail.com", phone: "9404581931", altPhone: "8149143134" },
  { enrollment: "25TTT15", firstName: "Miraya", lastName: "Ojha", grade: "Grade 1", gender: "Female", section: "A", guardianName: "Arpit Ojha", relation: "Father", email: "arpitojha1@gmail.com", phone: "7743869413", altPhone: "9765422369" },
  { enrollment: "25TTT17", firstName: "Riaan", lastName: "Pawar", grade: "Grade 1", gender: "Male", section: "A", guardianName: "Sudarshan Pawar", relation: "Father", email: "sudarshan.pawar90@gmail.com", phone: "9011558021", altPhone: "9579169828" },

  // Grade 2 missing (6)
  { enrollment: "25TTT31", firstName: "Yuvaan", lastName: "Sahu", grade: "Grade 2", gender: "Male", section: "A", guardianName: "Yogesh Sahu", relation: "Father", email: "engyogi@gmail.com", phone: "9158910002", altPhone: "9767393647" },
  { enrollment: "25TTT34", firstName: "Adhiraj", lastName: "Shinde", grade: "Grade 2", gender: "Male", section: "A", guardianName: "Mahesh Shinde", relation: "Father", email: "mdshinde214@gmail.com", phone: "9527009534", altPhone: "7447440811" },
  { enrollment: "25TTT52", firstName: "Ritvee Sule", lastName: "Sule", grade: "Grade 2", gender: "Male", section: "A", guardianName: "Sanand Sule", relation: "Father", email: "sanandsule@gmail.com", phone: "9833858988", altPhone: "9766828679" },
  { enrollment: "25TTT56", firstName: "Adita", lastName: "Patra", grade: "Grade 2", gender: "Female", section: "A", guardianName: "Bijit kumar Patra", relation: "Father", email: "bijitkumarpatra@gmail.com", phone: "9900923398", altPhone: "8147858456" },
  { enrollment: "25TTT58", firstName: "Aadhya", lastName: "Rodage", grade: "Grade 2", gender: "Female", section: "A", guardianName: "Prakash Rodage", relation: "Father", email: "prakashrodage501@gmail.com", phone: "9765225478", altPhone: "9765225478" },
  { enrollment: "25TTT60", firstName: "Gaeul", lastName: "Chae", grade: "Grade 2", gender: "Male", section: "A", guardianName: "Chae", relation: "Father", email: "solomon4300@gmail.com", phone: "9356021464", altPhone: "7028268139" },

  // Grade 3 missing (1)
  { enrollment: "25TTT65", firstName: "Sharvari", lastName: "Pahapalkar", grade: "Grade 3", gender: "Male", section: "A", guardianName: "Abhijeet", relation: "Father", email: "avp8787@gmail.com", phone: "9860741987", altPhone: "7774826288" },

  // TTTPN missing (8)
  { enrollment: "25TTTPN0073", firstName: "Viraj", lastName: "Prasad", grade: "Playgroup", gender: "Male", section: "A", guardianName: "Abhimanyu", relation: "Father", email: "abhimanyu.prasad@gmail.com", phone: "9823397545", altPhone: "8605696660" },
  { enrollment: "26TTTPN0033", firstName: "Indra", lastName: "Patil", grade: "LKG", gender: "Female", section: "A", guardianName: "Piyush", relation: "Father", email: "PIYU200594@GMAIL.COM", phone: "9272529122", altPhone: null },
  { enrollment: "26TTTPN0037", firstName: "Aarishi", lastName: "Singh", grade: "Nursery", gender: "Female", section: "A", guardianName: "Vikrant Singh", relation: "Father", email: "vikrantbt.27@gmail.com", phone: "9619774546", altPhone: "8744985809" },
  { enrollment: "25TTTPN0035", firstName: "Dhruva", lastName: "Badane", grade: "Nursery", gender: "Female", section: "A", guardianName: "Rohit", relation: "Father", email: "Rohitbhadane8766@gmail.com", phone: "9421488104", altPhone: "9404754146" },
  { enrollment: "26TTTPN0041", firstName: "Saanvi", lastName: "Parab", grade: "LKG", gender: "Female", section: "A", guardianName: "Vijay", relation: "Father", email: "vijayparab33@gmail.com", phone: "7738043133", altPhone: "7738063133" },
  { enrollment: "26TTTPN0040", firstName: "Ridhaan", lastName: "Pawar", grade: "Nursery", gender: "Male", section: "A", guardianName: "Abhijit", relation: "Father", email: "abhijitpawar5@gmail.com", phone: "9860233332", altPhone: "9763214169" },
  { enrollment: "25TTTPN0036", firstName: "Miraya", lastName: "Singh", grade: "Nursery", gender: "Female", section: "A", guardianName: "Piyush", relation: "Father", email: "singh.piyush86@gmail.com", phone: "9923197122", altPhone: "8806028985" },
  { enrollment: "26TTTPN0036", firstName: "Athang", lastName: "Tarange", grade: "Nursery", gender: "Male", section: "A", guardianName: "Kishor", relation: "Father", email: "kishor515tarange@gmail.com", phone: "8668946340", altPhone: "8010605064" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const sql = postgres(url, { prepare: false });

  let inserted = 0;
  let skipped = 0;
  const log: string[] = [];

  await sql.begin(async (tx) => {
    for (const r of ROWS) {
      // Skip if a student already exists for this enrollment under TTTPN.
      const dup = await tx`
        SELECT id FROM students
         WHERE school_id = ${TTTPN_SCHOOL_ID}
           AND enrollment_number = ${r.enrollment}
         LIMIT 1
      `;
      if (dup.count > 0) {
        skipped++;
        log.push(`SKIP  ${r.enrollment} (already exists)`);
        continue;
      }

      // Resolve / create parent by phone.
      await tx`
        INSERT INTO parents (phone, name, email)
        VALUES (${r.phone}, ${r.guardianName}, ${r.email})
        ON CONFLICT (phone) DO NOTHING
      `;
      const parentRow = await tx<{ id: string }[]>`
        SELECT id FROM parents WHERE phone = ${r.phone} LIMIT 1
      `;
      const parentId = parentRow[0].id;

      // Insert student.
      const studentRow = await tx<{ id: string }[]>`
        INSERT INTO students (
          school_id, parent_id, name, first_name, last_name,
          grade, gender, section, enrollment_number, school_code, status
        ) VALUES (
          ${TTTPN_SCHOOL_ID}, ${parentId},
          ${`${r.firstName} ${r.lastName}`.replace(/\s+/g, " ").trim()},
          ${r.firstName}, ${r.lastName},
          ${r.grade}, ${r.gender}, ${r.section}, ${r.enrollment}, ${"TTTPN"},
          'active'
        )
        RETURNING id
      `;
      const studentId = studentRow[0].id;

      // Insert guardian link.
      await tx`
        INSERT INTO student_guardian_links (
          student_id, row_idx, guardian_name, relation, email, phone_no
        ) VALUES (
          ${studentId}, 1, ${r.guardianName}, ${r.relation}, ${r.email}, ${r.phone}
        )
      `;

      inserted++;
      log.push(`OK    ${r.enrollment.padEnd(14)} ${r.firstName} ${r.lastName} (${r.grade})`);
    }
  });

  for (const line of log) console.log(line);
  console.log("\n=== DONE ===");
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped:  ${skipped}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
