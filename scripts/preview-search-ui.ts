/**
 * Simulates /api/auth/recover/search response for a few sample students and
 * renders the result-card UI as ASCII — to preview without rebuilding the app.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });
import postgres from "postgres";

function maskPhone(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length < 4) return "—";
  return "••••••" + d.slice(-4);
}
function normaliseRelation(r: string | null | undefined): "Father" | "Mother" | null {
  const t = (r ?? "").trim();
  if (!t) return null;
  const tc = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return tc === "Father" || tc === "Mother" ? tc : null;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const rows = (await sql`
      SELECT s.id, s.name, s.enrollment_number AS enrollment,
             m.school_name,
             p.phone AS parent_phone,
             (SELECT jsonb_agg(jsonb_build_object('phone', x.phone_no, 'relation', x.relation) ORDER BY x.row_idx)
              FROM student_guardian_links x WHERE x.student_id = s.id AND x.phone_no IS NOT NULL AND x.phone_no <> '') AS phones
      FROM students s
      JOIN mcb_students m ON m.enrolment_number = s.enrollment_number
      LEFT JOIN parents p ON p.id = s.parent_id
      WHERE s.enrollment_number IN ('26BP0856', '22BP0246', '23WMJK0135', '23SMS0830')
      ORDER BY s.enrollment_number
    `) as any[];

    for (const r of rows) {
      const seen = new Set<string>();
      const phones: { relation: string | null; mobileMasked: string }[] = [];
      for (const ph of (r.phones ?? [])) {
        const ten = String(ph.phone ?? "").replace(/\D/g, "").slice(-10);
        if (ten.length !== 10 || seen.has(ten)) continue;
        seen.add(ten);
        phones.push({ relation: normaliseRelation(ph.relation), mobileMasked: maskPhone(ph.phone) });
      }
      const pTen = String(r.parent_phone ?? "").replace(/\D/g, "").slice(-10);
      if (pTen.length === 10 && !seen.has(pTen)) {
        seen.add(pTen);
        phones.push({ relation: null, mobileMasked: maskPhone(r.parent_phone) });
      }
      const phoneLine = phones
        .map((ph) => (ph.relation ? `${ph.relation} ` : "") + ph.mobileMasked)
        .join("    ");
      const w = Math.max(48, phoneLine.length + 4);
      const top = "┌" + "─".repeat(w - 2) + "┐";
      const bot = "└" + "─".repeat(w - 2) + "┘";
      const pad = (s: string) => "│  " + s + " ".repeat(Math.max(0, w - 3 - s.length - 1)) + "│";
      console.log();
      console.log(top);
      console.log(pad(r.name));
      console.log(pad(`${r.enrollment} · ${(r.school_name ?? "").slice(0, 25)}`));
      console.log(pad(phoneLine || "—"));
      console.log(pad("Use any of these numbers to log in."));
      console.log(bot);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
