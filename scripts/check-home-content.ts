import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";

async function main() {
  const rows = await db.select().from(contentBlocks);
  for (const r of rows) {
    const json = JSON.stringify(r.data);
    const preview = json.length > 120 ? json.slice(0, 120) + "…" : json;
    console.log(`${r.key.padEnd(22)}  len=${json.length}  ${preview}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
