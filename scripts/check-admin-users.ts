import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { db } from "@/db/client";
import { users } from "@/db/schema";

async function main() {
  const rows = await db.select().from(users);
  if (rows.length === 0) {
    console.log("No admin users in DB. Run `npx tsx db/seed.ts` to seed.");
  } else {
    for (const u of rows) {
      console.log(
        `${u.email.padEnd(30)}  role=${u.role}  schoolId=${u.schoolId ?? "—"}`
      );
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
