import "server-only";
import { parseJson } from "@/server/api-handler";

/**
 * Alias of server/api-handler.ts `parseJson` — same 400 payload
 * `{ error, details, issues }`. Kept so the 64 routes that import
 * `parseBody` keep working; new code imports parseJson directly.
 */
export const parseBody = parseJson;
