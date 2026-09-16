/**
 * Read-only MCB probe: list every branch the token can reach, and (with
 * --branch=<id>) count students + fee rows per academic year for one of them.
 * Nothing is written — this is the "what would we be importing" step before
 * a branch is added to MCB_BRANCH_IDS and the 7 hardcoded lists.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });

const BASE = process.env.MCB_API_BASE || "https://api.myclassboard.com";
const KEY = process.env.MCB_API_KEY || "";
const TOKEN = process.env.MCB_TOKEN_ID || "";
const ORG = process.env.MCB_ORGANISATION_ID || "39";

async function get(p: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ TokenID: TOKEN, ...params });
  const r = await fetch(`${BASE}${p}?${qs}`, {
    headers: { Accept: "application/json", api_key: KEY },
  });
  if (!r.ok) throw new Error(`${p} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
const arr = (x: any): any[] =>
  Array.isArray(x) ? x : Array.isArray(x?.Data) ? x.Data : Array.isArray(x?.data) ? x.data : [];

async function main() {
  if (!KEY || !TOKEN) throw new Error("MCB_API_KEY / MCB_TOKEN_ID missing (.env.deploy)");
  const want = process.argv.find((a) => a.startsWith("--branch="))?.split("=")[1];

  const branches = arr(await get("/api/ClassAcademicData/GET_Branches", { OrganisationID: ORG }));
  console.log(`branches visible to this token: ${branches.length}`);
  for (const b of branches) {
    const id = b.BranchID ?? b.BranchId ?? b.branchId;
    const name = b.BranchName ?? b.branchName;
    console.log(`  ${String(id).padStart(4)}  ${name}`);
  }

  if (!want) return;
  const b = branches.find((x: any) => String(x.BranchID ?? x.BranchId) === want);
  console.log(`\n--- branch ${want} = ${b ? (b.BranchName ?? b.branchName) : "NOT VISIBLE TO TOKEN"} ---`);
  if (!b) return;

  for (const ay of (process.env.MCB_ACADEMIC_YEAR_IDS || "17,18").split(",")) {
    let students: any[] = [];
    try {
      students = arr(await get("/api/ClassAcademicData/GET_StudentsByAcademicYear", {
        BranchID: want, AcademicYearID: ay.trim(),
      }));
    } catch (e: any) { console.log(`  AY=${ay} students ERROR ${e.message.slice(0, 120)}`); }
    let fees: any[] = [];
    try {
      fees = arr(await get("/api/StudentFeeData/GET_StudentFeeReceivables_Tally", {
        FromDate: "04/01/2024", ToDate: "09/10/2026",
        BranchID: want, OrganisationID: ORG, AcademicYearID: ay.trim(),
      }));
    } catch (e: any) { console.log(`  AY=${ay} fees ERROR ${e.message.slice(0, 120)}`); }
    console.log(`  AY=${ay} students=${students.length} feeRows=${fees.length}`);
    const s = students[0];
    if (s) {
      console.log(`    sample: enroll=${s.StudentEnrollmentCode ?? s.AdmissionNumber ?? s.EnrollmentNumber ?? "?"} class=${s.ClassName ?? "?"} group=${s.ClassGroupName ?? "?"} branchName=${s.BranchName ?? "?"}`);
      const prefixes = new Map<string, number>();
      for (const x of students) {
        const en = String(x.StudentEnrollmentCode ?? x.AdmissionNumber ?? x.EnrollmentNumber ?? "");
        const p = en.replace(/\d+$/, "").slice(0, 8) || "(blank)";
        prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
      }
      console.log(`    enrolment prefixes: ${[...prefixes.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([p, n]) => `${p}×${n}`).join(", ")}`);
    }
  }
}
main().catch((e) => { console.error("[probe] fatal:", e.message ?? e); process.exit(1); });
