import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orderNotifications, orders, parents, students } from "@/db/schema";
import { sendOrderConfirmationSms } from "./sms";
import { sendEmail } from "./email";

/**
 * Post-payment order-confirmation fan-out: one SMS + one email per
 * confirmed order (multi-school baskets get one pair per sibling order,
 * each carrying its own order number). Every attempt — success, vendor
 * failure, or "no email on file" — lands as a row in order_notifications,
 * which doubles as the idempotency guard: a 'sent' row for an (order,
 * channel) pair suppresses re-sends from any path that re-enters (the
 * admin status PATCH, a replayed callback, …). Resend from the dashboard
 * passes force=true to bypass that guard deliberately.
 *
 * Best-effort throughout — never throws to the payment finaliser.
 */

const KIND = "order_confirmed";

type OrderRow = {
  id: string;
  orderNumber: string;
  total: number;
  shippingAddress: unknown;
  studentName: string | null;
};

type ParentRow = {
  name: string | null;
  phone: string;
  email: string | null;
};

function receiverPhone(shippingAddress: unknown): string | null {
  const addr = shippingAddress as { receiverPhone?: string } | null;
  return addr?.receiverPhone ?? null;
}

function receiverName(shippingAddress: unknown): string | null {
  const addr = shippingAddress as { receiverName?: string } | null;
  return addr?.receiverName ?? null;
}

/**
 * The greeting name for an order's notifications. parents.name went blank
 * on a chunk of orders after a late-May 2026 checkout regression, so we
 * fall back to the order's shipping receiverName (a required checkout
 * field — present on 100% of recent blank-parent orders) and then the
 * linked student's name. sendOrderConfirmationSms still does the
 * first-word + 30-char trim, so pass the full name through.
 */
function resolveDisplayName(order: OrderRow, parent: ParentRow): string | null {
  return (
    parent.name?.trim() ||
    receiverName(order.shippingAddress)?.trim() ||
    order.studentName?.trim() ||
    null
  );
}

function publicBase(): string {
  return (
    process.env.APP_PUBLIC_URL?.replace(/\/+$/, "") ??
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
    "https://inventre.in"
  );
}

function confirmationEmail(
  parentName: string | null,
  order: OrderRow
): { subject: string; html: string; text: string } {
  const name = parentName?.trim() || "Customer";
  const totalRupees = (order.total / 100).toLocaleString("en-IN");
  const orderUrl = `${publicBase()}/shop/orders/${order.id}`;
  const subject = `Order ${order.orderNumber} confirmed — Inventre`;
  const text = [
    `Dear ${name},`,
    ``,
    `Your order ${order.orderNumber} has been successfully placed.`,
    `Order total: ₹${totalRupees}`,
    ``,
    `You will receive updates once it is processed. Track it any time at ${orderUrl}`,
    ``,
    `INVENTRE EDUSERVICES PVT. LTD`,
  ].join("\n");
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1917">
    <h2 style="color:#c2410c;margin-bottom:4px">Order confirmed</h2>
    <p>Dear ${name},</p>
    <p>Your order <strong>${order.orderNumber}</strong> has been successfully placed.</p>
    <p style="font-size:18px;margin:16px 0"><strong>Order total: ₹${totalRupees}</strong></p>
    <p>You will receive updates once it is processed.</p>
    <p style="margin:24px 0">
      <a href="${orderUrl}"
         style="background:#c2410c;color:#fff;padding:12px 24px;border-radius:9999px;text-decoration:none;font-weight:bold">
        Track your order
      </a>
    </p>
    <p style="color:#78716c;font-size:12px;margin-top:32px">INVENTRE EDUSERVICES PVT. LTD</p>
  </div>`;
  return { subject, html, text };
}

async function hasSentRow(orderId: string, channel: "sms" | "email") {
  const [row] = await db
    .select({ id: orderNotifications.id })
    .from(orderNotifications)
    .where(
      and(
        eq(orderNotifications.orderId, orderId),
        eq(orderNotifications.channel, channel),
        eq(orderNotifications.kind, KIND),
        eq(orderNotifications.status, "sent")
      )
    )
    .limit(1);
  return !!row;
}

async function nextAttempt(orderId: string, channel: "sms" | "email") {
  const [row] = await db
    .select({
      max: sql<number>`coalesce(max(${orderNotifications.attempt}), 0)`,
    })
    .from(orderNotifications)
    .where(
      and(
        eq(orderNotifications.orderId, orderId),
        eq(orderNotifications.channel, channel),
        eq(orderNotifications.kind, KIND)
      )
    );
  return (row?.max ?? 0) + 1;
}

async function logAttempt(row: {
  orderId: string;
  orderNumber: string;
  channel: "sms" | "email";
  recipient: string;
  subject?: string | null;
  body?: string | null;
  status: "sent" | "failed";
  vendorId?: string | null;
  error?: string | null;
  attempt: number;
}) {
  try {
    await db.insert(orderNotifications).values({ ...row, kind: KIND });
  } catch (e) {
    console.error("[order-confirmation] log insert failed:", e);
  }
}

async function sendSmsForOrder(order: OrderRow, parent: ParentRow) {
  const phone = parent.phone || receiverPhone(order.shippingAddress) || "";
  const attempt = await nextAttempt(order.id, "sms");
  if (!phone) {
    await logAttempt({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: "sms",
      recipient: "",
      status: "failed",
      error: "no phone on file",
      attempt,
    });
    return;
  }
  try {
    const res = await sendOrderConfirmationSms(
      phone,
      resolveDisplayName(order, parent),
      order.orderNumber
    );
    await logAttempt({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: "sms",
      recipient: phone,
      body: res.text,
      status: "sent",
      vendorId: res.transactionId,
      attempt,
    });
  } catch (e) {
    await logAttempt({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: "sms",
      recipient: phone,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      attempt,
    });
  }
}

async function sendEmailForOrder(order: OrderRow, parent: ParentRow) {
  const attempt = await nextAttempt(order.id, "email");
  if (!parent.email) {
    await logAttempt({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: "email",
      recipient: "",
      status: "failed",
      error: "no email on file",
      attempt,
    });
    return;
  }
  const msg = confirmationEmail(resolveDisplayName(order, parent), order);
  const res = await sendEmail({
    to: parent.email,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  await logAttempt({
    orderId: order.id,
    orderNumber: order.orderNumber,
    channel: "email",
    recipient: parent.email,
    subject: msg.subject,
    body: msg.text,
    status: res.ok ? "sent" : "failed",
    vendorId: res.id ?? null,
    error: res.ok ? null : (res.error ?? "send failed"),
    attempt,
  });
}

/**
 * Fire confirmation SMS + email for an order (and its orderGroupId
 * siblings, unless includeSiblings=false). Safe to call repeatedly —
 * channels with an existing 'sent' row are skipped unless force=true.
 */
export async function notifyOrderConfirmed(
  orderId: string,
  opts?: {
    includeSiblings?: boolean;
    channels?: ("sms" | "email")[];
    force?: boolean;
  }
): Promise<void> {
  try {
    const [primary] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.total,
        shippingAddress: orders.shippingAddress,
        studentName: students.name,
        orderGroupId: orders.orderGroupId,
        name: parents.name,
        phone: parents.phone,
        email: parents.email,
      })
      .from(orders)
      .innerJoin(parents, eq(parents.id, orders.parentId))
      .leftJoin(students, eq(students.id, orders.studentId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!primary) return;

    const parent: ParentRow = {
      name: primary.name,
      phone: primary.phone,
      email: primary.email,
    };

    let targets: OrderRow[] = [primary];
    if (primary.orderGroupId && opts?.includeSiblings !== false) {
      const group = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          total: orders.total,
          shippingAddress: orders.shippingAddress,
          studentName: students.name,
        })
        .from(orders)
        .leftJoin(students, eq(students.id, orders.studentId))
        .where(eq(orders.orderGroupId, primary.orderGroupId));
      // The group query includes the primary — keep its row once.
      targets = group.filter(
        (o, i) => group.findIndex((x) => x.id === o.id) === i
      );
    }

    const channels = opts?.channels ?? (["sms", "email"] as const);
    for (const order of targets) {
      for (const channel of channels) {
        try {
          if (!opts?.force && (await hasSentRow(order.id, channel))) continue;
          if (channel === "sms") await sendSmsForOrder(order, parent);
          else await sendEmailForOrder(order, parent);
        } catch (e) {
          console.error(
            `[order-confirmation] ${channel} for ${order.orderNumber} failed:`,
            e
          );
        }
      }
    }
  } catch (e) {
    console.error("[order-confirmation] notifyOrderConfirmed failed:", e);
  }
}

/**
 * Dashboard "Resend": re-fire ONE channel for the order behind a failed
 * log row. Contact info is re-resolved at send time, so a parent who
 * added their email after the original failure gets the mail.
 */
export async function resendNotification(
  logId: string
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({
      orderId: orderNotifications.orderId,
      channel: orderNotifications.channel,
      status: orderNotifications.status,
    })
    .from(orderNotifications)
    .where(eq(orderNotifications.id, logId))
    .limit(1);
  if (!row) return { ok: false, error: "log row not found" };
  if (row.status !== "failed")
    return { ok: false, error: "only failed notifications can be resent" };

  await notifyOrderConfirmed(row.orderId, {
    includeSiblings: false,
    channels: [row.channel as "sms" | "email"],
    force: true,
  });

  // Report the outcome of the attempt we just logged.
  const [latest] = await db
    .select({
      status: orderNotifications.status,
      error: orderNotifications.error,
    })
    .from(orderNotifications)
    .where(
      and(
        eq(orderNotifications.orderId, row.orderId),
        eq(orderNotifications.channel, row.channel),
        eq(orderNotifications.kind, KIND)
      )
    )
    .orderBy(desc(orderNotifications.createdAt))
    .limit(1);
  if (latest?.status === "sent") return { ok: true };
  return { ok: false, error: latest?.error ?? "resend failed" };
}
