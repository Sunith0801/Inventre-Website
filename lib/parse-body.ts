import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Parse a JSON request body against a Zod schema. On failure returns a
 * NextResponse with status 400 and a flat `error` string + `issues` array,
 * so admin forms can render field-level messages instead of a bare 500.
 *
 * Usage:
 *   const parsed = await parseBody(req, Body);
 *   if (parsed instanceof NextResponse) return parsed;
 *   const body = parsed; // typed as z.infer<typeof Body>
 */
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T> | NextResponse> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      {
        error: result.error.issues.map((i) => i.message).join("; "),
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }
  return result.data;
}
