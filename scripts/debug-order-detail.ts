/* eslint-disable no-console */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { getParentOrderDetailFromErp, getParentOrderDetailLocal } from "@/server/erp-customer-orders";

async function main() {
  const PARENT = "a6fee0d9-1fcb-4526-ab9f-f47030933cf1";
  const ORDER = "SAL-ORD-2026-19026";
  const fromErp = await getParentOrderDetailFromErp(PARENT, ORDER);
  console.log("---fromErp null?", fromErp === null);
  if (fromErp) {
    console.log("categoryGroups:", JSON.stringify(fromErp.categoryGroups, null, 2));
  } else {
    const local = await getParentOrderDetailLocal(PARENT, ORDER);
    console.log("---local categoryGroups:", JSON.stringify(local?.categoryGroups, null, 2));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
