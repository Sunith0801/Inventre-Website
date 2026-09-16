"use client";

import { useEffect, useState } from "react";
import { findActive, sectionHref, visibleItems, type NavItem, type NavSection } from "@/lib/admin-nav";

/**
 * Where the "←" at the top of every admin page should go.
 *
 * Two answers, in order of preference:
 *
 *  1. WHERE THE USER CAME FROM. Opening a customer from a payment and
 *     pressing "←" lands back on that payment, not on a Customers list the
 *     user has never seen. The trail of admin URLs visited in this tab is
 *     kept in sessionStorage; the entry before the current one is the
 *     answer, with its query string intact so list filters survive.
 *
 *  2. ONE LEVEL UP, otherwise: a page below a module's root goes to the
 *     module root (order → Sales Orders, FAQs → content hub); a module root
 *     goes to its section landing page.
 *
 * How the trail moves (see `recordVisit`):
 *  - Arriving at a page whose path is already on the trail — browser back,
 *    the "←" link, the same list with new filters or another page number, a
 *    list reached again after deleting one of its records — cuts the trail
 *    back to that point. Filter changes therefore never become back steps,
 *    and a page left behind (or deleted) is never offered as "back".
 *  - Going UP through "←" to a page that was not on the trail drops the page
 *    just left, so the parent's arrow cannot point straight back down to it.
 *
 * Server-rendered HTML always shows answer 2 — storage is client-only — and
 * answer 1 replaces it after mount.
 */
const KEY = "admin:trail";
const BACK_KEY = "admin:trail:back";
const MAX = 30;

export type BackLink = { href: string; label: string };

function readTrail(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeTrail(t: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(t.slice(-MAX)));
  } catch {
    /* private mode / quota — the fallback answer still works */
  }
}

const pathOf = (url: string): string => url.split("?")[0] ?? url;

/** Call from the "←" link's onClick: the next page is reached by going back. */
export function markBackNavigation(href: string): void {
  try {
    sessionStorage.setItem(BACK_KEY, href);
  } catch {
    /* ignore */
  }
}

function takeBackMark(): string | null {
  try {
    const v = sessionStorage.getItem(BACK_KEY);
    if (v !== null) sessionStorage.removeItem(BACK_KEY);
    return v;
  } catch {
    return null;
  }
}

/**
 * The trail after visiting `current`. Pure, so it can be unit-tested; it is
 * also idempotent (React runs effects twice in development).
 *
 * @param viaBack the visit came from clicking "←" (not the browser button).
 */
export function recordVisit(trail: readonly string[], current: string, viaBack: boolean): string[] {
  const next = [...trail];
  const path = pathOf(current);
  let idx = -1;
  for (let i = next.length - 1; i >= 0; i--) {
    if (pathOf(next[i]!) === path) {
      idx = i;
      break;
    }
  }
  if (idx >= 0) {
    // Back to a page already on the trail: cut everything from it onward,
    // then re-add it with the current query string.
    next.splice(idx);
  } else if (viaBack) {
    // Up through "←" to a page never on the trail (a record opened in a
    // fresh tab, then "one level up"): the page just left is not a place to
    // come back to.
    next.pop();
  }
  next.push(current);
  return next.slice(-MAX);
}

/** The name of an admin URL as the sidebar would call it. */
function labelFor(url: string): string {
  const hit = findActive(pathOf(url));
  if (hit?.item) return hit.item.label;
  if (hit?.section) return hit.section.kicker;
  return "Back";
}

export function oneLevelUp(
  pathname: string,
  section: NavSection | null,
  item: NavItem | null,
  perms: ReadonlySet<string>
): BackLink | null {
  if (!section) return null;
  if (!item) {
    // A page that belongs to a section without being one of its sidebar
    // modules (the settings sub-pages): up is the section. A section landing
    // page has nowhere further up.
    return pathname.startsWith("/admin/sections/") ? null : { href: sectionHref(section), label: section.kicker };
  }
  const atModuleRoot = pathname === item.href;
  if (atModuleRoot && visibleItems(perms, section).length <= 1) return null;
  return atModuleRoot
    ? { href: sectionHref(section), label: section.kicker }
    : { href: item.href, label: item.label };
}

export function useAdminBackLink(
  pathname: string,
  search: string,
  section: NavSection | null,
  item: NavItem | null,
  perms: ReadonlySet<string>
): BackLink | null {
  const fallback = oneLevelUp(pathname, section, item, perms);
  const [fromTrail, setFromTrail] = useState<BackLink | null>(null);

  useEffect(() => {
    const current = search ? `${pathname}?${search}` : pathname;
    const mark = takeBackMark();
    const trail = recordVisit(readTrail(), current, mark !== null && pathOf(mark) === pathname);
    writeTrail(trail);

    const prev = trail[trail.length - 2];
    const prevPath = prev ? pathOf(prev) : undefined;
    // The page the user actually came from wins — it keeps list filters
    // ("View pending", a search) and cross-module hops (a customer opened
    // from a payment) intact. Section landing pages are never returned to:
    // pure navigation, and "one level up" already points at them when that
    // is the right answer.
    const useTrail = !!prev && !!prevPath && !prevPath.startsWith("/admin/sections/");
    setFromTrail(useTrail ? { href: prev, label: labelFor(prev) } : null);
  }, [pathname, search]);

  // The dashboard is the admin's home: there is nothing "back" from it, and a
  // "← Customers (Parents)" over the Overview only says where the user was.
  if (pathname === "/admin/dashboard") return null;

  const link = fromTrail ?? fallback;
  // The page header already prints the section name as its eyebrow, so a
  // link that would repeat it ("← Finance" over "FINANCE / Payments") reads
  // as a stutter. Where the destination IS the section, say "Back".
  if (link && section && link.label === section.kicker) return { ...link, label: "Back" };
  return link;
}
