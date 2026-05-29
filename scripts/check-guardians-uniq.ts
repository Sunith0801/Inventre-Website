import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
async function main() {
  const i = await sql`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'student_guardian_links'`;
  console.log(i);
  await sql.end();
}
main();
