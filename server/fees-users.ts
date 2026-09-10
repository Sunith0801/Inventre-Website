import "server-only";

/**
 * Fee-ledger account management — the escalation fence.
 *
 * A fee-ledger admin manages the people who look at /fees. They must NOT be
 * given `settings-users.write`, because that page edits every admin account
 * including super admins: a fee admin could grant themselves catalog.write,
 * or reset the super admin's password. So account management for this area
 * is a separate, deliberately narrow surface, and every rule that keeps it
 * narrow lives here rather than being restated at each call site.
 *
 * Two invariants, enforced in lib/…/fees/users/route.ts:
 *   1. A fee admin may only touch users whose role is one of MANAGED_ROLES.
 *      Every other account — super, ops, school admin — is invisible and
 *      untouchable, so there is nothing to escalate *through*.
 *   2. A fee admin may only assign a role from MANAGED_ROLES, whose
 *      permissions are all fees-scoped. They cannot mint an account with
 *      more reach than their own.
 */

/** Role slugs a fee-ledger admin is allowed to see and assign. */
export const FEES_VIEWER_ROLE = "fees-viewer";
export const FEES_ADMIN_ROLE = "fees-admin";
export const MANAGED_ROLES: readonly string[] = [FEES_VIEWER_ROLE, FEES_ADMIN_ROLE];

/**
 * Permission prefixes that belong to the fee ledger rather than to /admin.
 * Note both forms: `fees.read` (the dashboard) and `fees-users.write`
 * (managing its accounts). `"fees-users.write".startsWith("fees.")` is
 * false, so a single prefix would silently treat a fee admin as a staff
 * admin and let them into /admin.
 */
export const FEES_SCOPED_PREFIXES: readonly string[] = ["fees.", "fees-users."];

export function isFeesScopedPermission(p: string): boolean {
  return FEES_SCOPED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** True when every permission this account holds belongs to the fee ledger. */
export function isFeesOnlyAccount(perms: ReadonlySet<string>): boolean {
  if (perms.size === 0) return false;
  for (const p of perms) if (!isFeesScopedPermission(p)) return false;
  return true;
}

/**
 * Password floor for accounts minted here. These logins are handed out by
 * hand and never rotate on their own, so a weak one lives for years.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (/^\s|\s$/.test(password)) {
    return "Password cannot start or end with a space";
  }
  return null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
export function emailProblem(email: string): string | null {
  if (!email) return "Email is required";
  if (email.length > 160) return "Email is too long";
  if (!EMAIL_RE.test(email)) return "That does not look like an email address";
  return null;
}
