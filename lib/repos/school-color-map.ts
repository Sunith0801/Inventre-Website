import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { schoolColorMap } from "@/db/schema";
import type { ColorMap } from "@/lib/variant-code";

/**
 * Per-school color map repo. The new authoritative source is
 * `school_color_map` (one row per letter); the legacy JSONB column on
 * `schools.color_map` is only read as a fallback for schools that haven't
 * been backfilled yet.
 *
 * Cached per-process by schoolId — color maps change ~never, and every
 * variant lookup pays this otherwise.
 */
const cache = new Map<string, { at: number; map: ColorMap }>();
const TTL_MS = 5 * 60_000;

export async function getColorMap(schoolId: string): Promise<ColorMap> {
  const hit = cache.get(schoolId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

  const rows = await db
    .select()
    .from(schoolColorMap)
    .where(eq(schoolColorMap.schoolId, schoolId));

  const map: ColorMap = {};
  for (const r of rows) {
    map[r.letter] = { label: r.label, hex: r.hex ?? undefined };
  }
  cache.set(schoolId, { at: Date.now(), map });
  return map;
}

export async function upsertColorEntry(args: {
  schoolId: string;
  letter: string;
  label: string;
  hex?: string | null;
  notes?: string | null;
}) {
  await db
    .insert(schoolColorMap)
    .values({
      schoolId: args.schoolId,
      letter: args.letter,
      label: args.label,
      hex: args.hex ?? null,
      notes: args.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [schoolColorMap.schoolId, schoolColorMap.letter],
      set: {
        label: args.label,
        hex: args.hex ?? null,
        notes: args.notes ?? null,
        updatedAt: new Date(),
      },
    });
  cache.delete(args.schoolId);
}

export async function deleteColorEntry(schoolId: string, letter: string) {
  await db
    .delete(schoolColorMap)
    .where(
      and(
        eq(schoolColorMap.schoolId, schoolId),
        eq(schoolColorMap.letter, letter)
      )
    );
  cache.delete(schoolId);
}
