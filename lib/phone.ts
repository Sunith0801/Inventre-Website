import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

/**
 * Normalize a free-form phone string to its last 10 digits.
 * Returns null if fewer than 10 digits remain after stripping non-digits.
 * Mirrors the SQL normalization used by OTP verify, so JS-side checks
 * stay in lockstep with database matching.
 */
export function last10(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Drizzle SQL fragment: last 10 digits of a stored phone column.
 * Use as: sql`${last10Sql(column)} = ${normalizedInput}`
 */
export function last10Sql(column: SQL | unknown): SQL {
  return sql`right(regexp_replace(coalesce(${column as SQL}, ''), '\D', '', 'g'), 10)`;
}

/**
 * Zod schema for a required phone input: strips non-digits, keeps the last
 * 10, rejects anything that doesn't yield exactly 10 digits. Use for
 * endpoints where a phone is mandatory (registration, OTP request).
 */
export const phone10Schema = z
  .string()
  .transform((s) => last10(s))
  .refine((v): v is string => v !== null, {
    message: "Mobile number must contain 10 digits",
  });

/**
 * Same as phone10Schema but accepts null / undefined / empty string and
 * returns null in those cases. Use for optional admin fields (guardian
 * alternate number, supplier phone, etc.).
 */
export const phone10NullableSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((s) => (s == null || s === "" ? null : last10(s)))
  .refine((v) => v === null || /^\d{10}$/.test(v), {
    message: "Mobile number must contain 10 digits",
  });
