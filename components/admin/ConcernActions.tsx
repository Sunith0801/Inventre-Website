"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin actions on a Parent Concern: change status, assign an agent, and
 * reply to the parent. Posts to /api/admin/concerns/[id] and refreshes the
 * server-rendered detail page (which re-reads the thread + status).
 */

const STATUSES = [
  "submitted",
  "in_progress",
  "waiting_customer",
  "waiting_school",
  "resolved",
] as const;

export function ConcernActions({
  concernId,
  status,
  assignedToName,
}: {
  concernId: string;
  status: string;
  assignedToName: string | null;
}) {
  const router = useRouter();
  const [st, setSt] = useState(status);
  const [assignee, setAssignee] = useState(assignedToName ?? "");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<null | "save" | "reply">(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function patch() {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/concerns/${concernId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ status: st, assignedToName: assignee.trim() || null }),
      });
      if (!res.ok) {
        setMsg((await res.json().catch(() => ({}))).error || "Could not save.");
        return;
      }
      setMsg("Saved.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy("reply");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/concerns/${concernId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (!res.ok) {
        setMsg((await res.json().catch(() => ({}))).error || "Could not send.");
        return;
      }
      setReply("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const field = "w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="space-y-4">
      <h3 className="font-display text-[15px] font-bold text-ink-900">Manage</h3>

      <div>
        <label className="block text-[12px] font-semibold text-ink-700">Status</label>
        <select value={st} onChange={(e) => setSt(e.target.value)} className={`${field} mt-1`}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[12px] font-semibold text-ink-700">Assign to</label>
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="Agent name"
          className={`${field} mt-1`}
        />
      </div>

      <button
        onClick={patch}
        disabled={busy !== null}
        className="w-full rounded-xl bg-ink-900 py-2.5 text-[13px] font-semibold text-white hover:bg-ink-800 transition disabled:opacity-50"
      >
        {busy === "save" ? "Saving…" : "Save status & assignment"}
      </button>

      <div className="border-t border-cream-100 pt-4">
        <label className="block text-[12px] font-semibold text-ink-700">Reply to parent</label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Type a reply — it's added to the ticket history."
          className={`${field} mt-1`}
        />
        <button
          onClick={sendReply}
          disabled={busy !== null || !reply.trim()}
          className="mt-2 w-full rounded-xl bg-brand py-2.5 text-[13px] font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
        >
          {busy === "reply" ? "Sending…" : "Send reply"}
        </button>
      </div>

      {msg ? <p className="text-[12px] font-medium text-ink-500">{msg}</p> : null}
    </div>
  );
}
