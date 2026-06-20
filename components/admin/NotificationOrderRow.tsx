"use client";

import { useState } from "react";
import { Eye, X, Mail, MessageSquare } from "lucide-react";
import { Badge, Td, Tr } from "@/components/admin/ui/primitives";
import { NotificationResendButton } from "./NotificationResendButton";

export type ChannelRow = {
  id: string;
  recipient: string;
  status: string; // 'sent' | 'failed'
  vendorId: string | null;
  error: string | null;
  attempt: number;
  subject: string | null;
  body: string | null;
};

/**
 * One merged dashboard row per sale order: the order's latest SMS attempt and
 * latest email attempt side by side. "View" opens the exact message content
 * (subject + body) that was sent to the customer.
 */
export function NotificationOrderRow({
  orderId,
  orderNumber,
  time,
  email,
  sms,
  canWrite,
}: {
  orderId: string;
  orderNumber: string;
  time: string;
  email: ChannelRow | null;
  sms: ChannelRow | null;
  canWrite: boolean;
}) {
  const [view, setView] = useState<null | "email" | "sms">(null);
  const viewing = view === "email" ? email : view === "sms" ? sms : null;

  return (
    <>
      <Tr>
        <Td className="whitespace-nowrap align-top">{time}</Td>
        <Td className="align-top">
          <a
            href={`/admin/orders/${orderId}`}
            className="font-semibold text-ink-900 hover:underline"
          >
            {orderNumber}
          </a>
        </Td>
        <Td className="align-top">
          <ChannelCell
            row={email}
            channel="email"
            canWrite={canWrite}
            onView={() => setView("email")}
          />
        </Td>
        <Td className="align-top">
          <ChannelCell
            row={sms}
            channel="sms"
            canWrite={canWrite}
            onView={() => setView("sms")}
          />
        </Td>
      </Tr>

      {viewing && (
        <MessageModal
          channel={view as "email" | "sms"}
          orderNumber={orderNumber}
          row={viewing}
          onClose={() => setView(null)}
        />
      )}
    </>
  );
}

function ChannelCell({
  row,
  channel,
  canWrite,
  onView,
}: {
  row: ChannelRow | null;
  channel: "email" | "sms";
  canWrite: boolean;
  onView: () => void;
}) {
  if (!row) {
    return <span className="text-ink-300">— no {channel} —</span>;
  }
  return (
    <div className="space-y-1.5">
      <div
        className="font-medium text-ink-800 truncate max-w-[240px]"
        title={row.recipient}
      >
        {row.recipient || "—"}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={row.status === "sent" ? "success" : "danger"} size="sm">
          {row.status === "sent" ? "Sent" : "Failed"}
        </Badge>
        {row.attempt > 1 && (
          <span className="text-[11px] text-ink-400">attempt {row.attempt}</span>
        )}
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-[12px] font-semibold text-ink-700 hover:bg-ink-50"
        >
          <Eye className="h-3 w-3" />
          View
        </button>
        {canWrite && row.status === "failed" && (
          <NotificationResendButton logId={row.id} />
        )}
      </div>
      {row.error && (
        <div
          className="text-[11px] text-red-600 truncate max-w-[240px]"
          title={row.error}
        >
          {row.error}
        </div>
      )}
    </div>
  );
}

function MessageModal({
  channel,
  orderNumber,
  row,
  onClose,
}: {
  channel: "email" | "sms";
  orderNumber: string;
  row: ChannelRow;
  onClose: () => void;
}) {
  const Icon = channel === "email" ? Mail : MessageSquare;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-ink-500" />
            <div>
              <div className="text-[14px] font-semibold text-ink-900">
                {channel === "email" ? "Email" : "SMS"} · {orderNumber}
              </div>
              <div className="text-[12px] text-ink-500">
                to {row.recipient || "—"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-[13px]">
          <Meta label="Status">
            <Badge tone={row.status === "sent" ? "success" : "danger"} size="sm">
              {row.status === "sent" ? "Sent" : "Failed"}
            </Badge>
          </Meta>
          {row.vendorId && <Meta label="Vendor ID">{row.vendorId}</Meta>}
          <Meta label="Attempt">{row.attempt}</Meta>
          {row.error && (
            <Meta label="Error">
              <span className="text-red-600">{row.error}</span>
            </Meta>
          )}
          {channel === "email" && row.subject && (
            <Meta label="Subject">{row.subject}</Meta>
          )}

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              {channel === "email" ? "Body" : "Message"}
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-ink-100 bg-cream-50 p-3 font-sans text-[13px] text-ink-800">
              {row.body || "—"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 flex-shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
        {label}
      </span>
      <span className="text-ink-800">{children}</span>
    </div>
  );
}
