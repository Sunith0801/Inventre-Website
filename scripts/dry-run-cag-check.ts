// Dry-run: check the CAG roster against students table.
//
//   Board CBSE → school CASNIBMCBSE (0b82f2f9…)
//   Board CIE  → school CASNIBMCIE  (1a95c93f…)
//   Board TTT  → flagged separately (one row: 26CAG20365)
//
// "As per school Grade" numeric → "Grade N"; "Nursery"/"LKG"/etc kept as-is.
// Report per row: not-found, school mismatch, grade mismatch, or OK.

import postgres from "postgres";

const SCHOOL_CBSE = "0b82f2f9-7ad7-4a20-9fb0-69771dc485ba";
const SCHOOL_CIE  = "1a95c93f-e814-4cd9-9cb0-df672c6d593b";

type Row = {
  enrollment: string;
  name: string;
  board: string;
  grade: string;
};

const ROWS: Row[] = [
  { enrollment: "26CAG20355", name: "Alfiya Sartaj Ali",            board: "CBSE", grade: "11" },
  { enrollment: "26CAG20356", name: "VAISHANAVI VINOD PRASAD",      board: "CBSE", grade: "11" },
  { enrollment: "26CAG20357", name: "Vivaan Ravi Kamdar",           board: "CBSE", grade: "11" },
  { enrollment: "26CAG20362", name: "Kashvi Ganesh Nimbalkar",      board: "CIE",  grade: "1"  },
  { enrollment: "26CAG20363", name: "MITANSH SURAJ JADHAV",         board: "CBSE", grade: "1"  },
  { enrollment: "22CAG20258", name: "Parin Chetan Agarwal",         board: "CBSE", grade: "11" },
  { enrollment: "24CAG20142", name: "Harsh Samariya",               board: "CBSE", grade: "11" },
  { enrollment: "23CAG20179", name: "Chetna Joshi",                 board: "CBSE", grade: "11" },
  { enrollment: "26CAG20358", name: "ARNAV MANDAR SHINDE",          board: "CBSE", grade: "7"  },
  { enrollment: "26CAG20359", name: "Sehrish Ali",                  board: "CBSE", grade: "5"  },
  { enrollment: "26CAG20360", name: "Akshita Milan Nawle",          board: "CBSE", grade: "1"  },
  { enrollment: "26CAG20361", name: "Sameer Amol Jadhaw",           board: "CBSE", grade: "1"  },
  { enrollment: "26CAG20364", name: "Rudraansh Raghwendra Prakash", board: "CBSE", grade: "5"  },
  { enrollment: "26CAG20365", name: "Kabir Anand Mule",             board: "TTT",  grade: "Nursery" },
  { enrollment: "26CAG20366", name: "AKMAL AZAD ALI",               board: "CBSE", grade: "11" },
  { enrollment: "26CAG20367", name: "ALLAN",                        board: "CBSE", grade: "4"  },
  { enrollment: "24CAG20621", name: "Aaryan Kumar Dubey",           board: "CBSE", grade: "11" },
  { enrollment: "26CAG20369", name: "Akshara Pandurang Shewale",    board: "CBSE", grade: "11" },
  { enrollment: "26CAG20368", name: "Garvik Dinesh Bothra",         board: "CBSE", grade: "1"  },
  { enrollment: "26CAG20372", name: "Zikra Saifi",                  board: "CBSE", grade: "6"  },
  { enrollment: "26CAG20370", name: "Izran Saifi",                  board: "CBSE", grade: "5"  },
  { enrollment: "26CAG20371", name: "Daaniya Saad Uddin",           board: "CBSE", grade: "4"  },
  { enrollment: "26CAG20373", name: "KYSHA MOHIT PURSNANI",         board: "CIE",  grade: "9"  },
  { enrollment: "26CAG20374", name: "SPANDAN DEEPAK PATIL",         board: "CIE",  grade: "4"  },
  { enrollment: "26CAG20375", name: "Faliha Shaikh",                board: "CBSE", grade: "8"  },
  { enrollment: "26CAG20376", name: "Abdullah Shaikh",              board: "CBSE", grade: "3"  },
  { enrollment: "26CAG20377", name: "Shreyash onkar Umap",          board: "CBSE", grade: "1"  },
  { enrollment: "23CAG20279", name: "Pranjal Ravindra Ghule",       board: "CBSE", grade: "11" },
  { enrollment: "26CAG20378", name: "Laksh Vineet Dangi",           board: "CBSE", grade: "11" },
  { enrollment: "26CAG20379", name: "Riddhi Shirish Patil",         board: "CBSE", grade: "9"  },
  { enrollment: "26CAG20381", name: "Mohammed Zulqarnain Khan",     board: "CBSE", grade: "1"  },
  { enrollment: "23CAG20628", name: "Aarna Nitin Mehra",            board: "CBSE", grade: "11" },
  { enrollment: "26CAG20380", name: "Samruddhi Sahadev Dharmavat",  board: "CBSE", grade: "1"  },
  { enrollment: "26CAG20332", name: "Jia Sanjay Keswani",           board: "CIE",  grade: "7"  },
  { enrollment: "23CAG20059", name: "Kuldeep Bansriyar Mohanta",    board: "CBSE", grade: "4"  },
  { enrollment: "22CAG20053", name: "Nysha Somani",                 board: "CIE",  grade: "11" },
  { enrollment: "22CAG20208", name: "Mahi Sharma",                  board: "CBSE", grade: "11" },
  { enrollment: "26CAG20382", name: "Shasta Dhar",                  board: "CBSE", grade: "11" },
  { enrollment: "26CAG20383", name: "Vedant Ravindra Ghule",        board: "CBSE", grade: "11" },
  { enrollment: "26CAG20384", name: "Ayaan Nisar Ahemad Khan",      board: "CBSE", grade: "11" },
  { enrollment: "26CAG20385", name: "Piyush Shankarlal Bhati",      board: "CBSE", grade: "11" },
  { enrollment: "26CAG20386", name: "Laxman Rajendrasingh Rajpurohit", board: "CBSE", grade: "8" },
];

function expectedGrade(raw: string): string {
  return /^\d+$/.test(raw) ? `Grade ${raw}` : raw;
}

function expectedSchoolId(board: string): string | null {
  if (board === "CBSE") return SCHOOL_CBSE;
  if (board === "CIE")  return SCHOOL_CIE;
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const sql = postgres(url, { prepare: false });

  const missing: string[] = [];
  const schoolMismatch: string[] = [];
  const gradeMismatch: string[] = [];
  const ok: string[] = [];
  const boardUnknown: string[] = [];

  for (const r of ROWS) {
    const expSchool = expectedSchoolId(r.board);
    const expGrade  = expectedGrade(r.grade);

    if (!expSchool) {
      boardUnknown.push(`${r.enrollment.padEnd(12)} ${r.name.padEnd(35)} board=${r.board}, grade=${r.grade}`);
    }

    const rows = await sql<{ school_id: string; school_code: string; grade: string | null; name: string }[]>`
      SELECT s.school_id, sch.school_code, s.grade, s.name
        FROM students s
        JOIN schools sch ON sch.id = s.school_id
       WHERE s.enrollment_number = ${r.enrollment}
       LIMIT 1
    `;
    if (rows.length === 0) {
      missing.push(`${r.enrollment.padEnd(12)} ${r.name.padEnd(35)} (board ${r.board}, grade ${r.grade})`);
      continue;
    }
    const cur = rows[0];
    const expSchoolCode = r.board === "CBSE" ? "CASNIBMCBSE" : r.board === "CIE" ? "CASNIBMCIE" : "(TTT?)";
    const sMatch = expSchool ? cur.school_id === expSchool : false;
    const gMatch = (cur.grade ?? "") === expGrade;

    if (!sMatch) {
      schoolMismatch.push(`${r.enrollment.padEnd(12)} ${cur.name.padEnd(35)} DB=${cur.school_code} → expected=${expSchoolCode}`);
    }
    if (!gMatch) {
      gradeMismatch.push(`${r.enrollment.padEnd(12)} ${cur.name.padEnd(35)} DB=${String(cur.grade).padEnd(10)} → expected=${expGrade}`);
    }
    if (sMatch && gMatch) {
      ok.push(`${r.enrollment.padEnd(12)} ${cur.name.padEnd(35)} ${cur.grade}`);
    }
  }

  console.log("=== NOT FOUND ===");
  missing.forEach((l) => console.log("  " + l));
  console.log(`\n=== SCHOOL MISMATCHES (${schoolMismatch.length}) ===`);
  schoolMismatch.forEach((l) => console.log("  " + l));
  console.log(`\n=== GRADE MISMATCHES (${gradeMismatch.length}) ===`);
  gradeMismatch.forEach((l) => console.log("  " + l));
  console.log(`\n=== BOARD UNKNOWN (${boardUnknown.length}) ===`);
  boardUnknown.forEach((l) => console.log("  " + l));
  console.log("\n=== SUMMARY ===");
  console.log(`Pasted:            ${ROWS.length}`);
  console.log(`Not found:         ${missing.length}`);
  console.log(`School mismatches: ${schoolMismatch.length}`);
  console.log(`Grade mismatches:  ${gradeMismatch.length}`);
  console.log(`Fully OK:          ${ok.length}`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
