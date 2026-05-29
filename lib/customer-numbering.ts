/**
 * Customer code generator — CUST-YYYY-NNNNN. Backed by atomic numbering_counters
 * (see lib/numbering.ts).
 */

import "server-only";
import { allocCustomerCode } from "./numbering";

export const generateCustomerCode = allocCustomerCode;
