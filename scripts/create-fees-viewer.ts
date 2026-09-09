/**
 * Create (or reset) a view-only Fee ledger account.
 *
 * The account holds exactly one permission, `fees.read`, which gates
 * inventre.in/fees and its APIs. Deliberately NOT `mcb.read` — that would
 * also open /admin/mcb (MCB master data: every student, guardian phone
 * numbers, the sync console). A fee-desk user should see the ledger and
 * nothing else.
 *
 * `users.role` is set to the legacy `school_admin` enum, which is the
 * read-only tier (`isReadOnlyAdmin`); no admin page grants access on that
 * enum alone, so the permission set is the real gate. Post-login they land
 * on /fees via `firstAccessiblePath` (PAGE_HREF_OVERRIDES maps the "fees"
 * slug to /fees, outside /admin).
 *
 * Usage:
 *   FEES_USER_EMAIL=… FEES_USER_PASSWORD=… tsx scripts/create-fees-viewer.ts
 *   …--role=viewer|admin      viewer (default) = the ledger; admin = + /fees/users
 *   …--name="Fee Desk"        display name
 *   …--reset-password         update the password if the user already exists
 */
import postgres from "postgres";
import bcrypt from "@node-rs/bcrypt";
import { config } from "dotenv";

config({ path: ".env.local" });

const flag = (n: string) => process.argv.includes(`--${n}`);
const flagValue = (n: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

/**
 * Two roles, both fees-scoped:
 *   fees-viewer — the ledger and its receipts.
 *   fees-admin  — the same, plus /fees/users to manage these accounts.
 * `fees-admin` deliberately does NOT carry `settings-users.write`; see
 * lib/fees-users.ts for why that would be an escalation path.
 */
const ROLES: Record<string, { slug: string; name: string; desc: string; perms: string[] }> = {
  viewer: {
    slug: "fees-viewer",
    name: "Fee Ledger (view only)",
    desc: "Read-only access to the MyClassBoard fee ledger at /fees. No admin pages, no MCB master data.",
    perms: ["fees.read"],
  },
  admin: {
    slug: "fees-admin",
    name: "Fee Ledger Admin",
    desc: "The fee ledger, plus managing who else can open it (/fees/users). No access to staff admin accounts.",
    perms: ["fees.read", "fees-users.write"],
  },
};

async function main() {
  const kind = (flagValue("role") || "viewer") as keyof typeof ROLES;
  const spec = ROLES[kind];
  if (!spec) {
    console.error(`[fees-viewer] --role must be one of: ${Object.keys(ROLES).join(", ")}`);
    process.exit(1);
  }
  const { slug: ROLE_SLUG, name: ROLE_NAME, desc: ROLE_DESC, perms: PERMISSIONS } = spec;

  const email = (process.env.FEES_USER_EMAIL || "").trim().toLowerCase();
  const password = process.env.FEES_USER_PASSWORD || "";
  const name = flagValue("name") || "Fee Ledger Viewer";
  if (!email || !password) {
    console.error("[fees-viewer] FEES_USER_EMAIL and FEES_USER_PASSWORD are required");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("[fees-viewer] refusing a password shorter than 12 characters");
    process.exit(1);
  }
  const dsn = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;
  if (!dsn) {
    console.error("[fees-viewer] DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(dsn, { max: 2, prepare: false });

  const [role] = await sql<{ id: string }[]>`
    INSERT INTO admin_roles (slug, name, description, is_system)
    VALUES (${ROLE_SLUG}, ${ROLE_NAME}, ${ROLE_DESC}, false)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name,
                                     description = EXCLUDED.description,
                                     updated_at = now()
    RETURNING id
  `;
  console.log(`[fees-viewer] role ${ROLE_SLUG} → ${role.id}`);

  // Rewrite the permission set rather than adding to it, so re-running can
  // never leave a stale grant behind.
  await sql`DELETE FROM admin_role_permissions WHERE role_id = ${role.id}`;
  await sql`
    INSERT INTO admin_role_permissions (role_id, permission)
    SELECT ${role.id}, unnest(${PERMISSIONS}::text[])
  `;
  console.log(`[fees-viewer] permissions = ${PERMISSIONS.join(", ")}`);

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE email = ${email} LIMIT 1
  `;
  const hash = await bcrypt.hash(password, 12);

  if (existing.length > 0) {
    if (!flag("reset-password")) {
      console.error(
        `[fees-viewer] ${email} already exists — pass --reset-password to overwrite its password`
      );
      await sql.end({ timeout: 5 });
      process.exit(1);
    }
    await sql`
      UPDATE users
         SET password_hash = ${hash}, role_id = ${role.id}, role = 'school_admin',
             status = 'active', name = ${name}, school_id = NULL
       WHERE id = ${existing[0].id}
    `;
    console.log(`[fees-viewer] updated ${email} (${existing[0].id})`);
  } else {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, role, role_id, name, status)
      VALUES (${email}, ${hash}, 'school_admin', ${role.id}, ${name}, 'active')
      RETURNING id
    `;
    console.log(`[fees-viewer] created ${email} (${u.id})`);
  }

  // Clear any per-user overrides — the role is the whole story for this
  // account, and a leftover grant would silently widen it.
  await sql`
    DELETE FROM admin_user_permissions
     WHERE user_id = (SELECT id FROM users WHERE email = ${email})
  `;

  const perms = await sql<{ permission: string }[]>`
    SELECT p.permission
      FROM users u
      JOIN admin_role_permissions p ON p.role_id = u.role_id
     WHERE u.email = ${email}
     ORDER BY 1
  `;
  console.log(
    `[fees-viewer] effective permissions for ${email}: ${
      perms.map((p) => p.permission).join(", ") || "(none)"
    }`
  );
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error("[fees-viewer] fatal:", e);
  process.exit(1);
});
