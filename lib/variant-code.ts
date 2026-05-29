import "server-only";

/**
 * Parse ERP variant codes like:
 *
 *   SAM Boys PantK22$$         → school=SAM, parent=Boys Pant, color=K, size=22
 *   SAS BP Regular SocksJL$$$  → school=SAS BP, parent=Regular Socks, color=J, size=L
 *   SAS BP BeltL2XL$           → school=SAS BP, parent=Belt, color=L, size=2XL
 *
 * Pattern: {ParentName}{ColorLetter}{Size}{Separator}
 *  - Separator: trailing $, $$, or $$$
 *  - Color: single uppercase letter immediately before size
 *  - Size: numeric, "2XL", "4UK", "10S" etc. — everything between color
 *    letter and the separator
 *
 * Usage:
 *   const parsed = parseVariantCode("SAM Boys PantK22$$");
 *   // { schoolPrefix: "SAM", parent: "Boys Pant", color: "K", size: "22" }
 */

const SCHOOL_PREFIXES = [
  "SAS BP",
  "SAS KS",
  "SAS SC",
  "SAS",
  "SMS",
  "CAS LR",
  "CAS NIBM",
  "CAS",
  "WM JK",
  "WM WF",
  "Winmore Jakkur",
  "Winmore Whitefield",
  "KLINK",
  "KLS",
  "QLS",
  "SAMYU",
  "SAM",
  "TSUS",
  "DLSU",
];

const SEPARATORS = ["$$$", "$$", "$"]; // longest first

const SIZE_PATTERN = /^(?:\d+(?:UK|S|K)?|XS|S|M|L|XL|2XL|3XL|4XL)$/i;

export type ParsedVariantCode = {
  schoolPrefix: string | null;
  parent: string; // parent item name (best effort)
  color: string | null; // single letter
  size: string | null;
  separator: string | null;
  rawAfterParent: string;
};

export function parseVariantCode(code: string): ParsedVariantCode {
  let working = code.trim();

  // 1. Strip the trailing separator
  let separator: string | null = null;
  for (const sep of SEPARATORS) {
    if (working.endsWith(sep)) {
      separator = sep;
      working = working.slice(0, -sep.length);
      break;
    }
  }

  // 2. Strip leading school prefix
  let schoolPrefix: string | null = null;
  for (const p of SCHOOL_PREFIXES) {
    if (working.startsWith(p + " ") || working === p) {
      schoolPrefix = p;
      working = working.slice(p.length).trimStart();
      break;
    }
  }

  // 3. The remainder is `{Parent}{ColorLetter}{Size}`. Walk back from the end:
  //    Size is the trailing alnum+special block, prefixed by a single uppercase
  //    letter that is not part of the parent name.
  //
  // Heuristic:
  //   - find the last contiguous alphanumeric block (the size + maybe color)
  //   - if size starts with a single uppercase letter followed by a
  //     digit OR by the size pattern, peel that letter as color.

  // Find boundary: walk from end, collecting size characters until we hit a space
  let i = working.length;
  while (i > 0) {
    const c = working[i - 1];
    if (/[A-Za-z0-9]/.test(c)) {
      i--;
    } else {
      break;
    }
  }
  // working[i..] is the trailing alnum block
  const tail = working.slice(i);
  const beforeTail = working.slice(0, i).trim();

  // Try to split tail into [colorLetter][rest]
  let color: string | null = null;
  let size: string | null = null;
  if (tail.length >= 2) {
    const first = tail[0];
    const rest = tail.slice(1);
    if (/[A-Z]/.test(first) && (SIZE_PATTERN.test(rest) || /^\d/.test(rest))) {
      color = first;
      size = rest;
    }
  }
  // Fall-back: whole tail is size
  if (!size && tail) {
    size = tail;
  }

  return {
    schoolPrefix,
    parent: beforeTail || working,
    color,
    size,
    separator,
    rawAfterParent: tail,
  };
}

/**
 * Pretty-print a parsed code for human display.
 */
export function formatParsedCode(p: ParsedVariantCode): string {
  const parts: string[] = [];
  if (p.schoolPrefix) parts.push(p.schoolPrefix);
  parts.push(p.parent);
  if (p.color) parts.push(`Color: ${p.color}`);
  if (p.size) parts.push(`Size: ${p.size}`);
  return parts.join(" · ");
}

/**
 * Resolve a color letter against the audit's per-school color map.
 * Returns the human-readable label if known, else the original letter.
 */
export type ColorMap = Record<string, { label: string; hex?: string }>;

export function resolveColor(
  schoolPrefix: string | null,
  letter: string | null,
  colorMap: ColorMap | undefined
): { label: string; hex?: string } | null {
  if (!letter) return null;
  if (!colorMap) return { label: letter };
  const m = colorMap[letter];
  if (m) return m;
  return { label: letter };
}

/**
 * Normalize a size string for case-insensitive matching against the
 * productAttributeValues master.
 */
export function normalizeSize(s: string | null): string | null {
  if (!s) return null;
  return s.trim().toUpperCase();
}
