/**
 * Financial-year-aware invoice numbering.
 * Format: INV-YY-YY-NNNNN.
 *
 * Now backed by lib/numbering.ts which uses an atomic UPSERT against a
 * numbering_counters table — no COUNT(*), no row-locks held across the request.
 */

import "server-only";
import {
  allocInvoiceNumber,
  financialYear as _fy,
} from "./numbering";

export const financialYearOf = _fy;
export const generateInvoiceNumber = allocInvoiceNumber;
