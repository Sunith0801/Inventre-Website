import "server-only";
import { NextResponse } from "next/server";
import { z, type ZodError, type ZodTypeAny } from "zod";

/**
 * Request validation helpers. ONE 400 shape everywhere (F-18, 2026-09-23):
 *
 *   { error: "<messages joined by '; '>",       // flat, for a toast
 *     details: [{ path: "qty", message: "…" }], // per field, for forms
 *     issues: ZodIssue[] }                       // raw, for callers that
 *                                                // already read it
 *
 *   parseJson(req, schema)   body      → value | NextResponse(400)
 *   parseQuery(req, schema)  ?query    → value | NextResponse(400)
 *
 * server/parse-body.ts `parseBody` is an alias of parseJson kept so 64 routes
 * did not have to change their import.
 */
export function zodToErrorPayload(err: ZodError) {
  return {
    error: err.issues.map((i) => i.message).join("; ") || "Validation failed",
    details: err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
    issues: err.issues,
  };
}

export async function parseJson<T extends ZodTypeAny>(
  req: Request,
  schema: T
): Promise<z.infer<T> | NextResponse> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON", details: [], issues: [] },
      { status: 400 }
    );
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(zodToErrorPayload(result.error), { status: 400 });
  }
  return result.data;
}

export function parseQuery<T extends ZodTypeAny>(
  req: Request,
  schema: T
): z.infer<T> | NextResponse {
  const url = new URL(req.url);
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams.entries()) {
    const prev = obj[k];
    if (prev === undefined) obj[k] = v;
    else obj[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  const result = schema.safeParse(obj);
  if (!result.success) {
    return NextResponse.json(zodToErrorPayload(result.error), { status: 400 });
  }
  return result.data;
}
