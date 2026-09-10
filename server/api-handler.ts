import "server-only";
import { NextResponse } from "next/server";
import { z, type ZodError, type ZodTypeAny } from "zod";

/**
 * Shared API helpers — eliminate the repeated try/catch + Zod parsing across
 * route handlers. Two entry points:
 *
 *   parseJson(req, schema)      - parse + validate body, returning either
 *                                  the parsed value OR a NextResponse 400.
 *   parseQuery(req, schema)     - same, for URL search params.
 *
 *   apiHandler(handler)         - wraps a handler so any thrown Error becomes
 *                                  a JSON 500 (or 400 for ZodError) instead
 *                                  of bubbling to the framework's HTML page.
 *
 * Usage:
 *   const Body = z.object({ qty: z.number().int().min(1) });
 *
 *   export const POST = apiHandler(async (req) => {
 *     const body = await parseJson(req, Body);
 *     if (body instanceof NextResponse) return body;
 *     ...
 *   });
 */

function zodToErrorPayload(err: ZodError) {
  return {
    error: "Validation failed",
    details: err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
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
      { error: "Body must be valid JSON" },
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
  const params: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => {
    params[k] = v;
  });
  const result = schema.safeParse(params);
  if (!result.success) {
    return NextResponse.json(zodToErrorPayload(result.error), { status: 400 });
  }
  return result.data;
}

type RouteHandler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response> | Response;

/**
 * Wrap a Next.js route handler with uniform error handling. Catches:
 *   - ZodError    → 400 with details
 *   - Error       → 500 with message (only in dev) or generic message in prod
 *   - non-Error   → 500 generic
 */
export function apiHandler<Ctx = unknown>(
  handler: RouteHandler<Ctx>
): RouteHandler<Ctx> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json(zodToErrorPayload(e), { status: 400 });
      }
      const isDev = process.env.NODE_ENV !== "production";
      const message =
        e instanceof Error
          ? e.message
          : "Unknown error";
      console.error("[api]", req.method, new URL(req.url).pathname, e);
      return NextResponse.json(
        { error: isDev ? message : "Internal server error" },
        { status: 500 }
      );
    }
  };
}
