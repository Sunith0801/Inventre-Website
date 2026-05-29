/**
 * Read editable media slots from `content_blocks`, with a default fallback.
 *
 * Schema convention: one row per slot, keyed by `MediaSlot.key`, with
 * `data` shape `{ url: string, alt?: string }`. If no row exists or the
 * row is malformed, returns the slot's hard-coded default URL — so the
 * frontend is always safe to render.
 */
import "server-only";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";
import { cached } from "@/lib/cache";
import { MEDIA_SLOTS, type MediaSlot, getSlot } from "@/lib/media-slots";

export type MediaSlotValue = { url: string; alt?: string | null };

function parseValue(raw: unknown): MediaSlotValue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || !r.url) return null;
  return { url: r.url, alt: typeof r.alt === "string" ? r.alt : null };
}

/** Resolve a single slot's URL (fallback to defaultUrl when unset). */
export async function getMediaUrl(
  key: string,
  defaultUrl: string,
): Promise<string> {
  return cached(`media:${key}`, 300, async () => {
    const [row] = await db
      .select({ data: contentBlocks.data })
      .from(contentBlocks)
      .where(eq(contentBlocks.key, key))
      .limit(1);
    const parsed = row ? parseValue(row.data) : null;
    return parsed?.url ?? defaultUrl;
  });
}

/**
 * Bulk-resolve every slot in MEDIA_SLOTS — used by the admin gallery so
 * we can render the whole list in a single round-trip.
 */
export async function getAllMediaSlotValues(): Promise<
  Map<string, MediaSlotValue>
> {
  const keys = MEDIA_SLOTS.map((s) => s.key);
  const rows = keys.length
    ? await db
        .select({ key: contentBlocks.key, data: contentBlocks.data })
        .from(contentBlocks)
        .where(inArray(contentBlocks.key, keys))
    : [];
  const out = new Map<string, MediaSlotValue>();
  for (const r of rows) {
    const v = parseValue(r.data);
    if (v) out.set(r.key, v);
  }
  return out;
}

/** Resolve effective URL for every slot (DB value or default). */
export async function getAllMediaUrls(): Promise<
  Array<{ slot: MediaSlot; url: string; alt: string | null; overridden: boolean }>
> {
  const stored = await getAllMediaSlotValues();
  return MEDIA_SLOTS.map((slot) => {
    const v = stored.get(slot.key);
    return {
      slot,
      url: v?.url ?? slot.defaultUrl,
      alt: v?.alt ?? null,
      overridden: !!v,
    };
  });
}

/** Quick lookup for one slot, returning the effective URL or default. */
export async function resolveMedia(key: string): Promise<string> {
  const slot = getSlot(key);
  if (!slot) throw new Error(`Unknown media slot: ${key}`);
  return getMediaUrl(slot.key, slot.defaultUrl);
}
