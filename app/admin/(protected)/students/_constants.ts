/**
 * Shared between the server page (page.tsx) and the client browser
 * (StudentsBrowser.tsx). Lives in its own non-"use client" module so
 * the value resolves at runtime in both environments — primitive
 * exports from a "use client" module do NOT survive the server→client
 * boundary cleanly and arrive as undefined on the server side, which
 * collapses LIMIT in the SSR query and ships 20,930 rows to the
 * browser (incident 2026-05-29).
 */
export const STUDENTS_PAGE_SIZE = 50;
