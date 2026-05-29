import "server-only";

/**
 * Notification template DSL.
 *
 * Templates use `{{ var.path }}` interpolation against the event payload.
 * Validation runs at save time so authors get a clear error instead of a
 * runtime hole at dispatch time (where missing vars silently render as "").
 *
 * Each event type declares the variables that will be present in the payload
 * the event-bus dispatches. Templates may only reference these keys.
 */

export type EventVarSchema = readonly string[];

/**
 * Variables emitted alongside each domain event. Keep this in sync with the
 * `emit(event, payload)` callsites — adding a new field here unlocks it for
 * notification authors.
 */
export const EVENT_VARS: Record<string, EventVarSchema> = {
  "order.placed": ["orderId", "orderNumber", "total", "email", "phone"],
  "order.confirmed": [
    "orderId",
    "orderNumber",
    "previousStatus",
    "status",
    "total",
    "email",
    "phone",
  ],
  "order.cancelled": [
    "orderId",
    "orderNumber",
    "previousStatus",
    "status",
    "total",
    "email",
    "phone",
  ],
  "order.shipped": [
    "orderId",
    "orderNumber",
    "previousStatus",
    "status",
    "total",
    "trackingNumber",
    "courier",
    "email",
    "phone",
  ],
  "order.delivered": [
    "orderId",
    "orderNumber",
    "previousStatus",
    "status",
    "total",
    "email",
    "phone",
  ],
  "shipment.created": [
    "shipmentId",
    "shipmentNumber",
    "orderId",
    "orderNumber",
    "trackingNumber",
    "courier",
    "email",
    "phone",
  ],
  "invoice.created": [
    "invoiceId",
    "invoiceNumber",
    "orderId",
    "orderNumber",
    "grandTotal",
    "email",
    "phone",
  ],
  "return.requested": [
    "returnId",
    "returnNumber",
    "orderId",
    "orderNumber",
    "reason",
    "email",
    "phone",
  ],
  "return.refunded": [
    "returnId",
    "returnNumber",
    "orderId",
    "orderNumber",
    "refundAmount",
    "email",
    "phone",
  ],
  "stock.low": ["variantId", "sku", "productName", "available", "minStockLevel"],
};

const VAR_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;
const TOKEN_SHAPE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

/** Strip {{...}} tokens from a template and return the bare variable paths. */
export function extractTemplateVars(tpl: string): string[] {
  const out: string[] = [];
  for (const m of tpl.matchAll(VAR_PATTERN)) {
    out.push(m[1]);
  }
  return out;
}

export type TemplateValidationError = {
  field: "subject" | "bodyTemplate";
  message: string;
};

export function validateTemplate(args: {
  eventType: string;
  channel: "email" | "sms" | "push";
  subject?: string | null;
  bodyTemplate?: string | null;
}): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];
  const allowed = EVENT_VARS[args.eventType];
  if (!allowed) {
    errors.push({
      field: "bodyTemplate",
      message: `Unknown event type "${args.eventType}". Known: ${Object.keys(EVENT_VARS).join(", ")}`,
    });
    return errors;
  }
  const allowedSet = new Set(allowed);

  // Channel-specific shape rules
  if (args.channel === "email") {
    if (!args.subject || args.subject.trim().length === 0) {
      errors.push({ field: "subject", message: "Email rules require a subject" });
    }
  }
  if (!args.bodyTemplate || args.bodyTemplate.trim().length === 0) {
    errors.push({ field: "bodyTemplate", message: "bodyTemplate is required" });
    return errors;
  }
  if (args.channel === "sms" && args.bodyTemplate.length > 480) {
    errors.push({
      field: "bodyTemplate",
      message: `SMS body must be ≤ 480 chars (got ${args.bodyTemplate.length})`,
    });
  }

  for (const [field, tpl] of [
    ["subject", args.subject ?? ""],
    ["bodyTemplate", args.bodyTemplate ?? ""],
  ] as const) {
    // Detect malformed braces (unterminated {{ or stray }})
    const opens = (tpl.match(/\{\{/g) ?? []).length;
    const closes = (tpl.match(/\}\}/g) ?? []).length;
    if (opens !== closes) {
      errors.push({
        field,
        message: `Unbalanced braces: ${opens} '{{' vs ${closes} '}}'`,
      });
    }
    for (const v of extractTemplateVars(tpl)) {
      if (!TOKEN_SHAPE.test(v)) {
        errors.push({
          field,
          message: `Invalid variable token "${v}"`,
        });
        continue;
      }
      const root = v.split(".")[0];
      if (!allowedSet.has(root)) {
        errors.push({
          field,
          message: `Variable "${v}" not available for event "${args.eventType}". Allowed roots: ${allowed.join(", ")}`,
        });
      }
    }
  }
  return errors;
}
