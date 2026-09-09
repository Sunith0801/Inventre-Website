import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { resendNotification } from "@/lib/order-confirmation";
import { logAdminActivity } from "@/lib/activity";

/**
 * Re-fire a failed order-confirmation notification (one channel, one
 * order). Contact info is re-resolved at send time, and the attempt is
 * appended to order_notifications — the dashboard shows the full history.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("order-notifications.write");
  if (isResponse(guard)) return guard;

  const { id } = await params;
  const result = await resendNotification(id);
  if (!result.ok) {
    const status = result.error === "log row not found" ? 404
      : result.error === "only failed notifications can be resent" ? 409
      : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  void logAdminActivity(guard, {
    action: "notification.resend",
    entityType: "notification",
    entityId: id,
    summary: "Resent order-confirmation notification",
    req,
  });
  return NextResponse.json({ ok: true });
}
