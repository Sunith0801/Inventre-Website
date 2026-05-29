/**
 * Registry of editable media slots used across the marketing site.
 *
 * One row per <img>/<video> on About / Contact / Experience Store /
 * Categories / Hero carousel / TheBox tiles / global logos etc.
 * The storefront reads each slot via getMediaUrl(slot.key, slot.defaultUrl)
 * and the admin gallery at /admin/content/media renders one card per slot.
 *
 * To add a new editable slot:
 *   1. Add an entry here with a unique key, the current hard-coded URL as
 *      `defaultUrl`, and a `description` saying where the image appears.
 *   2. Replace the hard-coded URL in the frontend component with the
 *      resolved URL (pass down from the server page).
 * That's it — no DB migration, no API change. The admin gallery picks it
 * up automatically because it iterates this registry.
 */
export type MediaSlotPageId =
  | "home"
  | "about"
  | "for-schools"
  | "contact"
  | "experience-store"
  | "login"
  | "global";

export type MediaSlot = {
  /** content_blocks.key — one row per slot. */
  key: string;
  pageId: MediaSlotPageId;
  pageLabel: string;
  /** Public URL of the page so the admin can "View on live site". */
  pageHref: string;
  /** Section heading shown in admin (under the page heading). */
  section: string;
  /** Short label for the slot card in admin. */
  label: string;
  /** One-liner under the label — explains where this image/video appears. */
  description: string;
  /** image | video | any — drives the thumbnail rendering in admin. "any"
   * accepts either type and the frontend picks <img>/<video> from the URL. */
  kind: "image" | "video" | "any";
  /** The current hard-coded URL — used as fallback when no DB row exists. */
  defaultUrl: string;
  /** Aspect-ratio hint shown in the admin uploader (e.g. "1:1", "16:9"). */
  aspect?: "1:1" | "16:9" | "9:16" | "4:5" | "3:4" | "free";
};

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";
const R2_ROOT = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev";

export const MEDIA_SLOTS: MediaSlot[] = [
  // ── / (home) ──────────────────────────────────────────────────────
  {
    key: "media.home.hero.video",
    pageId: "home", pageLabel: "Home", pageHref: "/",
    section: "Hero",
    label: "Hero video — right side",
    description: "Looping video playing in the hero section of the home page. Replaces the poster image once buffered.",
    kind: "video",
    defaultUrl: `${R2}/slider_1.mp4`,
    aspect: "4:5",
  },
  // ── /about ────────────────────────────────────────────────────────
  {
    key: "media.about.hero.image_1",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Hero",
    label: "Hero image — top",
    description: "Upper portrait collage in the About page hero.",
    kind: "image",
    defaultUrl: `${R2}/quality1.png`,
    aspect: "3:4",
  },
  {
    key: "media.about.hero.image_2",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Hero",
    label: "Hero image — bottom",
    description: "Lower portrait collage in the About page hero.",
    kind: "image",
    defaultUrl: `${R2}/quality2.png`,
    aspect: "3:4",
  },
  {
    key: "media.about.founder.video_1",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Founder story",
    label: "Founder video — top",
    description: "First clip in the Founder Story section on /about.",
    kind: "video",
    defaultUrl: `${R2}/slider_3.mp4`,
    aspect: "9:16",
  },
  {
    key: "media.about.founder.video_2",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Founder story",
    label: "Founder video — bottom",
    description: "Second clip in the Founder Story section on /about.",
    kind: "video",
    defaultUrl: `${R2}/slider_2.mp4`,
    aspect: "9:16",
  },
  {
    key: "media.about.innovations.magic_box_video",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Innovations",
    label: "Magic Box demo video",
    description: "Auto-playing video at the top of the Innovations section.",
    kind: "video",
    defaultUrl: `${R2}/Magic_Box.mp4`,
    aspect: "16:9",
  },
  {
    key: "media.about.innovations.quality_image_1",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Innovations",
    label: "Quality image — top",
    description: "First photo in the Innovations triptych.",
    kind: "image",
    defaultUrl: `${R2}/quality1.png`,
    aspect: "1:1",
  },
  {
    key: "media.about.innovations.quality_image_2",
    pageId: "about", pageLabel: "About", pageHref: "/about",
    section: "Innovations",
    label: "Quality image — bottom",
    description: "Second photo in the Innovations triptych.",
    kind: "image",
    defaultUrl: `${R2}/quality2.png`,
    aspect: "1:1",
  },

  // ── /for-schools (homepage section) ───────────────────────────────
  {
    key: "media.for_schools.magic_box_video",
    pageId: "for-schools", pageLabel: "For schools", pageHref: "/",
    section: "Hero",
    label: "Magic Box video",
    description: "Demo loop in the ForSchools section (shown on the homepage).",
    kind: "video",
    defaultUrl: `${R2}/Magic_Box.mp4`,
    aspect: "16:9",
  },

  // ── /contact ──────────────────────────────────────────────────────
  {
    key: "media.contact.hero.image_school",
    pageId: "contact", pageLabel: "Contact", pageHref: "/contact",
    section: "Hero cards",
    label: "Schools card image",
    description: "Photo shown on the 'For Schools' contact card.",
    kind: "image",
    defaultUrl: `${R2}/quality2.png`,
    aspect: "16:9",
  },
  {
    key: "media.contact.hero.image_business",
    pageId: "contact", pageLabel: "Contact", pageHref: "/contact",
    section: "Hero cards",
    label: "Business card image",
    description: "Photo shown on the 'Business / Partner' contact card.",
    kind: "image",
    defaultUrl: `${R2}/All-K-12-essentials.webp`,
    aspect: "16:9",
  },
  {
    key: "media.contact.hero.image_parent",
    pageId: "contact", pageLabel: "Contact", pageHref: "/contact",
    section: "Hero cards",
    label: "Parent card image",
    description: "Photo at the top of the 'Parent' contact card.",
    kind: "image",
    defaultUrl: `${R2_ROOT}/contact-parent.png`,
    aspect: "16:9",
  },
  // ── /experience-store ─────────────────────────────────────────────
  {
    key: "media.experience.hero.image",
    pageId: "experience-store", pageLabel: "Experience Store", pageHref: "/experience-store",
    section: "Hero",
    label: "Hero backdrop",
    description: "Large photo behind the Experience Store hero text.",
    kind: "image",
    defaultUrl: `${R2}/quality2.png`,
    aspect: "16:9",
  },
  {
    key: "media.experience.sneak_peek.image_1",
    pageId: "experience-store", pageLabel: "Experience Store", pageHref: "/experience-store",
    section: "Sneak peek",
    label: "Sneak peek #1",
    description: "First photo in the Store Sneak Peek gallery.",
    kind: "image",
    defaultUrl: `${R2}/quality1.png`,
    aspect: "4:5",
  },
  {
    key: "media.experience.sneak_peek.image_2",
    pageId: "experience-store", pageLabel: "Experience Store", pageHref: "/experience-store",
    section: "Sneak peek",
    label: "Sneak peek #2",
    description: "Second photo in the Store Sneak Peek gallery.",
    kind: "image",
    defaultUrl: `${R2}/Tshirt(product range).webp`,
    aspect: "4:5",
  },
  {
    key: "media.experience.sneak_peek.image_3",
    pageId: "experience-store", pageLabel: "Experience Store", pageHref: "/experience-store",
    section: "Sneak peek",
    label: "Sneak peek #3",
    description: "Third photo in the Store Sneak Peek gallery.",
    kind: "image",
    defaultUrl: `${R2}/quality2.png`,
    aspect: "4:5",
  },
  {
    key: "media.experience.sneak_peek.image_4",
    pageId: "experience-store", pageLabel: "Experience Store", pageHref: "/experience-store",
    section: "Sneak peek",
    label: "Sneak peek #4",
    description: "Fourth photo in the Store Sneak Peek gallery.",
    kind: "image",
    defaultUrl: `${R2}/All-K-12-essentials.webp`,
    aspect: "4:5",
  },
  {
    key: "media.experience.sneak_peek.image_5",
    pageId: "experience-store", pageLabel: "Experience Store", pageHref: "/experience-store",
    section: "Sneak peek",
    label: "Sneak peek #5",
    description: "Fifth photo in the Store Sneak Peek gallery.",
    kind: "image",
    defaultUrl: `${R2}/bags.png`,
    aspect: "4:5",
  },

  // ── /login (parent portal sign-in) ────────────────────────────────
  {
    key: "media.login.brand_panel.image",
    pageId: "login", pageLabel: "Login", pageHref: "/login",
    section: "Brand panel",
    label: "Brand panel photo or video",
    description: "Large hero photo or video on the right side of the parent sign-in page. Accepts images and videos.",
    kind: "any",
    defaultUrl: `${R2}/school_banner2.jpg`,
    aspect: "free",
  },
  {
    key: "media.login.brand_panel.logo",
    pageId: "login", pageLabel: "Login", pageHref: "/login",
    section: "Brand panel",
    label: "Brand panel logo",
    description: "Inventre logo shown over the login page brand panel.",
    kind: "image",
    defaultUrl: `${R2}/INVENTRE_LOGO.png`,
    aspect: "free",
  },
];

export function getSlot(key: string): MediaSlot | undefined {
  return MEDIA_SLOTS.find((s) => s.key === key);
}

/** Hex/Tailwind chip colors by page for visual recognition in admin. */
export const PAGE_COLORS: Record<MediaSlotPageId, { bg: string; text: string; ring: string }> = {
  home:               { bg: "bg-orange-100", text: "text-orange-900", ring: "ring-orange-300" },
  about:              { bg: "bg-sky-100",    text: "text-sky-900",    ring: "ring-sky-300" },
  contact:            { bg: "bg-emerald-100",text: "text-emerald-900",ring: "ring-emerald-300" },
  "experience-store": { bg: "bg-violet-100", text: "text-violet-900", ring: "ring-violet-300" },
  "for-schools":      { bg: "bg-teal-100",   text: "text-teal-900",   ring: "ring-teal-300" },
  login:              { bg: "bg-amber-100",  text: "text-amber-900",  ring: "ring-amber-300" },
  global:             { bg: "bg-ink-100",    text: "text-ink-900",    ring: "ring-ink-300" },
};

/** Filename from a URL, for the "Default source" hint on cards. */
export function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").pop() ?? "";
    return decodeURIComponent(seg);
  } catch {
    return url;
  }
}
