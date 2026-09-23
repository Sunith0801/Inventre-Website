/**
 * Reset ONE user's password and nothing else.
 *
 * Deliberately narrower than scripts/create-fees-viewer.ts --reset-password,
 * which also rewrites `role`, `role_id` and `school_id` — running that against
 * a staff/super-admin account would silently demote it to the fee-desk tier.
 * This touches `password_hash` only, so an account keeps every permission it
 * had. Same bcrypt cost (12) the login route verifies against.
 *
 * Usage:
 *   DATABASE_URL=… RESET_EMAIL=… RESET_PASSWORD=… npx tsx scripts/reset-user-password.ts
 *   …--show      print the account's role + effective permissions first, no write
 */
import postgres from "postgres";
import bcrypt from "@node-rs/bcrypt";

async function main() {
  const email = (process.env.RESET_EMAIL || "").trim().toLowerCase();
  const password = process.env.RESET_PASSWORD || "";
  const showOnly = process.argv.includes("--show");
  const dsn = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;

  if (!email) throw new Error("RESET_EMAIL is required");
  if (!dsn) throw new Error("DATABASE_URL is required (do not rely on .env.local — it points at dev)");
  if (!showOnly && password.length < 12) {
    throw new Error("refusing a password shorter than 12 characters");
  }

  const sql = postgres(dsn, { max: 2, prepare: false });

  const [user] = await sql<{ id: string; email: string; role: string; status: string }[]>`
    SELECT id, email, role, status FROM users WHERE email = ${email} LIMIT 1
  `;
  if (!user) {
    const near = await sql<{ email: string }[]>`
      SELECT email FROM users WHERE email LIKE ${"%" + email.split("@")[0] + "%"} ORDER BY email LIMIT 10
    `;
    console.error(`no account for ${email}. Similar: ${near.map((n) => n.email).join(", ") || "(none)"}`);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  const perms = await sql<{ permission: string }[]>`
    SELECT p.permission FROM admin_role_permissions p
      JOIN users u ON u.role_id = p.role_id WHERE u.id = ${user.id}::uuid
    UNION
    SELECT permission FROM admin_user_permissions WHERE user_id = ${user.id}::uuid
    ORDER BY 1
  `;
  const list = perms.map((p) => p.permission);
  console.log(`${user.email}  role=${user.role}  status=${user.status}`);
  console.log(`permissions: ${list.join(", ") || "(none — role enum is the only grant)"}`);
  console.log(
    `/fees login: ${
      list.some((p) => ["fees.read", "fees.write", "fees-users.write"].includes(p))
        ? "yes, at /fees/login"
        : "not via /fees/login — sign in at /admin/login instead (a staff admin session also opens /fees)"
    }`
  );

  if (showOnly) {
    await sql.end({ timeout: 5 });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}::uuid`;
  console.log(`password reset for ${user.email} — role and permissions untouched`);
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error("[reset-password] fatal:", e.message ?? e);
  process.exit(1);
});
