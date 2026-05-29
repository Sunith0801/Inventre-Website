import "server-only";
import { NextResponse } from "next/server";
import { getCurrentParent, type CurrentParent } from "./session";

/** Returns the parent or a 401 NextResponse. Pair with isResponse().
 *
 *  Uses the parent-only resolver: `getCurrentUser` prefers an admin cookie
 *  when one is present in the browser, which would falsely 401 a logged-in
 *  parent who also has a stale `inv_admin` cookie from the admin panel. */
export async function requireParent(): Promise<CurrentParent | NextResponse> {
  const me = await getCurrentParent();
  if (!me)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return me;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
