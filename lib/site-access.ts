import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";

/**
 * Site-wide storefront closure.
 *
 * The lockout itself is per-student: `students.enabled = false` already
 * removes a student from the storefront picker (lib/session.ts) and from
 * the admin-side family graph, and the per-student "Enabled" checkbox on
 * /admin/students/[id] flips exactly that field. What this flag adds is
 * *messaging*: when it's on, a signed-in parent left with zero enabled
 * students sees the "Website Access is Currently Closed" screen instead
 * of an empty storefront.
 *
 * Keeping the two separate matters. A parent can legitimately end up with
 * zero visible students in normal operation (every child removed from the
 * family, a stranded split account) — telling *them* the site is closed
 * would be a lie. So the screen only appears while ops have declared a
 * closure.
 */
export const SITE_ACCESS_KEY = "site.access_closed";

export type SiteAccess = {
  /** true → storefront is closed to everyone without an enabled student. */
  closed: boolean;
  /** Headline shown on the closed screen. */
  title: string;
  /** Sub-line shown under the headline. */
  subtitle: string;
};

export const DEFAULT_SITE_ACCESS: SiteAccess = {
  closed: false,
  title: "Website Access is Currently Closed",
  subtitle: "We'll be back shortly.",
};

function isSiteAccess(v: unknown): v is SiteAccess {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.closed === "boolean" &&
    typeof o.title === "string" &&
    typeof o.subtitle === "string"
  );
}

/**
 * Request-cached so the shop layout can call it on every render without
 * adding a query per page. `cache()` is per-request, so an admin flipping
 * the switch takes effect on the parent's next navigation.
 */
export const getSiteAccess = cache(async (): Promise<SiteAccess> => {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, SITE_ACCESS_KEY))
      .limit(1);
    const value = rows[0]?.value;
    return isSiteAccess(value) ? value : DEFAULT_SITE_ACCESS;
  } catch {
    // Never let a settings-table hiccup lock parents out of the store.
    return DEFAULT_SITE_ACCESS;
  }
});
