/**
 * Parser for bookkit language variants.
 *
 * ERPNext imports bookkits as separate product rows, one per language combo,
 * with names like:
 *   "SAS Suchitra Grade 2 BookkitHindi 2nd Lan Tel 3rd Lan"
 *   "SAS Suchitra Grade 2 BookkitTelugu 2nd Lan Hin 3rd Lan"
 *
 * This utility detects that pattern and splits the flat variant list into a
 * structured (2nd language, 3rd language) pair so the UI can show two
 * independent pickers instead of an inscrutable long-name list.
 */

// Full language name set (for short-pattern validation in
// `parseBookkitLangs`). Mirrors KNOWN_LANGS below.
const LANG_ABBR_INV = new Set([
  "Hindi", "Telugu", "Kannada", "Sanskrit", "Marathi", "Tamil",
  "Malayalam", "Urdu", "English", "Bengali", "Punjabi", "Gujarati",
  "Odia", "French", "Assamese", "Kashmiri", "Konkani", "Nepali", "Sindhi",
]);

// Three-letter ERP abbreviation → full language name
const LANG_ABBR: Record<string, string> = {
  Hin: "Hindi",
  Tel: "Telugu",
  Kan: "Kannada",
  San: "Sanskrit",
  Mar: "Marathi",
  Tam: "Tamil",
  Mal: "Malayalam",
  Urd: "Urdu",
  Eng: "English",
  Ben: "Bengali",
  Pun: "Punjabi",
  Guj: "Gujarati",
  Ori: "Odia",
  Fre: "French",
  Ass: "Assamese",
  Kas: "Kashmiri",
  Kon: "Konkani",
  Nep: "Nepali",
  Sin: "Sindhi",
};

export type LangPair = {
  /** variant id (product_variants.id or the template product id) */
  variantId: string;
  /** Original size string from product_variants.size — used for cart add */
  size: string;
  /** Full 2nd-language name, e.g. "Hindi" */
  secondLang: string;
  /** Full 3rd-language name, e.g. "Telugu" */
  thirdLang: string;
  /** Price in rupees (0 = unknown / same as parent) */
  price: number;
};

type MinVariant = { id: string; size: string; pricePaise?: number | null };

/**
 * Try to parse a set of variants as language-bookkit pairs.
 * Returns null when the variants don't match the bookkit language pattern,
 * so callers can fall back to the regular size-button UI.
 */
export function parseBookkitLangs(variants: MinVariant[]): LangPair[] | null {
  if (variants.length < 2) return null;

  const pairs: (LangPair | null)[] = variants.map((v) => {
    const price = v.pricePaise != null ? Math.round(v.pricePaise / 100) : 0;

    // (A) Full ERP pattern: "…Bookkit{PrimaryLang} 2nd Lan {ThirdAbbr} 3rd Lan"
    //     \s* allows an optional space between "Bookkit" and the language
    //     name (e.g. "Bookkit Hindi" vs "BookkitHindi").
    const full = v.size.match(/bookkit\s*(\w+)\s+\w+\s+lan\s+(\w{3})\s+\w+\s+lan/i);
    if (full) {
      const cap = full[1][0].toUpperCase() + full[1].slice(1).toLowerCase();
      if (LANG_ABBR_INV.has(cap) || cap in LANG_ABBR /* allow exact code */) {
        // pass-through
      }
      const secondLang = cap;
      const thirdAbbr = full[2];
      const thirdLang = LANG_ABBR[thirdAbbr] ?? thirdAbbr;
      return { variantId: v.id, size: v.size, secondLang, thirdLang, price };
    }

    // (B) Trailing-language pattern: anything ending in a known language
    //     name. Covers "...BookkitHindi" (WM WF / SMS) AND
    //     "...Bookkit w/o StationeryHindi" (CAS w/o-Stationery variants).
    //     Matching the explicit language whitelist keeps "Stationery" and
    //     "Bookkit" from leaking into the captured token.
    const langAlt = Array.from(LANG_ABBR_INV).join("|");
    const re = new RegExp(`(${langAlt})$`, "i");
    const tail = v.size.match(re);
    if (tail) {
      const cap = tail[1][0].toUpperCase() + tail[1].slice(1).toLowerCase();
      return { variantId: v.id, size: v.size, secondLang: cap, thirdLang: "", price };
    }
    return null;
  });

  if (pairs.some((p) => p === null)) return null;
  return pairs as LangPair[];
}

/** Recognised language names — used to disambiguate the "Bookkit<Lang>"
 *  pattern from kits whose name happens to end in a random word. */
const KNOWN_LANGS = new Set([
  "Hindi", "Telugu", "Kannada", "Sanskrit", "Marathi", "Tamil",
  "Malayalam", "Urdu", "English", "Bengali", "Punjabi", "Gujarati",
  "Odia", "French", "Assamese", "Kashmiri", "Konkani", "Nepali", "Sindhi",
]);

/** Extract 2nd language label from a kit name. Handles every naming
 *  variant seen across schools:
 *  - "...BookkitHindi 2nd Lan Kan 3rd Lan"  (SAS / CAS / WM JK suffixed)
 *  - "...Hindi 2nd Lang ..."                 (older variants)
 *  - "...BookkitHindi"                       (WM / SMS no suffix)
 *  - "...Bookkit w/o StationeryHindi"        (CAS w/o-Stationery variant)
 *  Returns null when no recognised language token is found. */
export function parseKitLang(name: string): string | null {
  // Build a regex out of the known language whitelist; matching the
  // trailing language word directly is more robust than chunking on
  // \w+ boundaries (which breaks when "Stationery" or "Bookkit" is
  // welded to the language token).
  const langAlt = Array.from(KNOWN_LANGS).join("|");
  // (1) "...<Lang> 2nd Lan" — language is the word right before "2nd Lan".
  const re1 = new RegExp(`(${langAlt})\\s+2nd\\s+lan`, "i");
  const m1 = name.match(re1);
  if (m1) return capLang(m1[1]);
  // (2) Trailing language token at the very end (handles "Bookkit w/o
  //     StationeryHindi" → "Hindi", "BookkitHindi" → "Hindi").
  const re2 = new RegExp(`(${langAlt})$`, "i");
  const m2 = name.match(re2);
  if (m2) return capLang(m2[1]);
  return null;
}

function capLang(raw: string): string {
  return raw[0].toUpperCase() + raw.slice(1).toLowerCase();
}

/** Extract 3rd language abbreviation → full name from a kit name like
 *  "SAS Suchitra Grade 7 BookkitHindi 2nd Lan Tel 3rd Lan" → "Telugu".
 *  Returns null when no 3rd-language token is present (WM / SMS style
 *  kits don't encode a 3rd language). */
export function parseKitThirdLang(name: string): string | null {
  const m = name.match(/\b(\w{3,})\s+3rd\s+lan/i);
  if (!m) return null;
  const abbr = m[1];
  // Try abbreviation lookup first (3-letter codes), then fall through
  // to the full name if the token is already a known language.
  if (LANG_ABBR[abbr]) return LANG_ABBR[abbr];
  const cap = abbr[0].toUpperCase() + abbr.slice(1).toLowerCase();
  if (KNOWN_LANGS.has(cap)) return cap;
  return abbr;
}
