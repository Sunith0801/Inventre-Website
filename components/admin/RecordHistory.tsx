import { listRecordActivity, type FieldChange } from "@/lib/activity";
import { History } from "lucide-react";

/**
 * Per-record audit trail — the "History" tab/section for any admin record.
 * Drop it onto a record page with the record's type + id:
 *
 *   <RecordHistory entityType="order" entityId={order.id} title="Order history" />
 *
 * Renders every logged action newest-first with: Date & Time · User (name +
 * role) · Action · per-field Old → New · Remarks · IP. Server component —
 * reads activity_log directly, no client fetch.
 */
export async function RecordHistory({
  entityType,
  entityId,
  title = "Activity log",
}: {
  entityType: string;
  entityId: string;
  title?: string;
}) {
  const rows = await listRecordActivity(entityType, entityId);

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3.5">
        <History className="h-4 w-4 text-ink-500" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">{title}</h3>
        <span className="ml-auto text-[12px] text-ink-500">{rows.length} event{rows.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-ink-500">
          No activity recorded yet. Actions on this record (status changes,
          edits, approvals…) will appear here.
        </p>
      ) : (
        <ol className="divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-ink-900 text-[13.5px]">
                  {actionLabel(r.action)}
                </span>
                <span className="text-[12px] text-ink-500">
                  by{" "}
                  <span className="font-medium text-ink-700">
                    {r.actorName || r.actorEmail || "System"}
                  </span>
                  {r.actorRole ? (
                    <span className="ml-1 rounded-full bg-ink-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-600">
                      {roleLabel(r.actorRole)}
                    </span>
                  ) : null}
                </span>
                <span className="ml-auto text-[11.5px] tabular-nums text-ink-500">
                  {fmtDateTime(r.createdAt)}
                </span>
              </div>

              {r.summary && (
                <p className="mt-0.5 text-[12.5px] text-ink-600">{r.summary}</p>
              )}

              {Array.isArray(r.changes) && r.changes.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {r.changes.map((c, i) => (
                    <ChangeRow key={i} change={c} />
                  ))}
                </ul>
              )}

              {r.remarks && (
                <p className="mt-1.5 text-[12px] text-ink-600">
                  <span className="font-semibold text-ink-500">Remarks: </span>
                  {r.remarks}
                </p>
              )}

              {r.ip && (
                <p className="mt-1 text-[10.5px] text-ink-400 tabular-nums">IP {r.ip}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: FieldChange }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      <span className="font-semibold text-ink-700">{change.label || change.field}:</span>
      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through decoration-rose-300">
        {fmtValue(change.old)}
      </span>
      <span className="text-ink-400">→</span>
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">
        {fmtValue(change.new)}
      </span>
    </li>
  );
}

function actionLabel(action: string): string {
  // "order.cancel" → "Order · Cancel"; keep it readable without a giant map.
  return action
    .split(".")
    .map((p) => p.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()))
    .join(" · ");
}

function roleLabel(role: string): string {
  switch (role) {
    case "super": return "Super Admin";
    case "ops": return "Customer Care";
    case "school_admin": return "School Admin";
    default: return role;
  }
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
