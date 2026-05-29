import type { CurrentAdmin } from "./session";

export type AdminRole = CurrentAdmin["role"];

export function isReadOnlyAdmin(role: AdminRole): boolean {
  return role === "school_admin";
}

export function canWriteAsAdmin(role: AdminRole): boolean {
  return !isReadOnlyAdmin(role);
}
