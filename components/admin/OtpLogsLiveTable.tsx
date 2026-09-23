"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { Badge, EmptyState, Td, Th, Tr } from "@/components/admin/ui/primitives";
import { MessageSquare } from "lucide-react";

export type OtpLogRow = {
  id: string;
  createdAt: string | Date;
  phone: string;
  purpose: string;
  event: string;
  /** true when a sealed code exists; the code itself never reaches the browser */
  hasCode: boolean;
  transactionId: string | null;
  error: string | null;
  ip: string | null;
};

function eventBadge(event: string) {
  if (event === "sent") return <Badge tone="success" size="sm">sent</Badge>;
  if (event === "verified") return <Badge tone="info" size="sm">verified</Badge>;
  if (event === "send_failed" || event === "verify_failed")
    return <Badge tone="danger" size="sm">{event.replace("_", " ")}</Badge>;
  return <Badge tone="default" size="sm">{event}</Badge>;
}

function purposeLabel(p: string) {
  const map: Record<string, string> = {
    login: "Login",
    "first-time": "First time",
    "recover-old": "Recovery (old)",
    "recover-new": "Recovery (new)",
  };
  return map[p] ?? p;
}

/**
 * Renders the OTP-logs table with optional live polling. Polling is
 * gated on `polling` (only enabled when the user is viewing page 1 of
 * the unfiltered-by-time list). The poll calls the GET endpoint with
 * `since_at` = the freshest createdAt the client has rendered, and
 * prepends any newly-returned rows to the displayed list, dedup'ing by
 * `id` so reordered fetches can't show the same row twice.
 *
 * Default cadence: 3 s, which matches the page header copy. The
 * indicator below the title surfaces last-refresh time + a flashing
 * "+N" pill when new rows arrive.
 */
/**
 * Per-row OTP reveal (P-01). Codes are sealed at rest; a staff member with
 * otp-logs.write types the key phrase and sees ONE code for 60 s. The
 * server logs every reveal to the activity log.
 */
function OtpCodeCell({ row, canReveal }: { row: OtpLogRow; canReveal: boolean }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const t = setTimeout(() => setCode(null), 60_000);
    return () => clearTimeout(t);
  }, [code]);

  if (!row.hasCode) return <span className="text-ink-300">—</span>;
  if (code)
    return (
      <span className="font-mono text-[14px] font-bold tracking-widest text-ink-900" title="Hides again in 60 s">
        {code}
      </span>
    );
  if (!canReveal) return <span className="font-mono text-[13px] tracking-widest text-ink-400">••••••</span>;

  async function reveal(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/data/otp-logs/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, phrase }),
      });
      const data = (await r.json()) as { code?: string | null; error?: string; unavailable?: boolean };
      if (!r.ok) {
        setErr(data.error ?? "Could not reveal");
        return;
      }
      if (!data.code) {
        setErr("Code unavailable (legacy row or key changed)");
        return;
      }
      setCode(data.code);
      setOpen(false);
      setPhrase("");
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-ink-200 px-2 py-0.5 font-mono text-[12px] tracking-widest text-ink-500 hover:border-ink-400 hover:text-ink-900"
        title="Reveal with the key phrase (logged)"
      >
        •••••• Reveal
      </button>
    );
  return (
    <form onSubmit={reveal} className="flex items-center gap-1">
      <input
        type="password"
        autoFocus
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="Key phrase"
        className="w-28 rounded border border-ink-200 px-2 py-0.5 text-[12px]"
        aria-label="OTP reveal key phrase"
      />
      <button type="submit" disabled={busy || !phrase} className="rounded bg-ink-900 px-2 py-0.5 text-[12px] text-white disabled:opacity-40">
        {busy ? "…" : "Show"}
      </button>
      <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="text-[12px] text-ink-400">
        ✕
      </button>
      {err ? <span className="text-[11px] text-red-500">{err}</span> : null}
    </form>
  );
}

export function OtpLogsLiveTable({
  initialRows,
  filterParams,
  polling,
  canReveal = false,
}: {
  initialRows: OtpLogRow[];
  filterParams: { phone?: string; purpose?: string; event?: string; since?: string };
  polling: boolean;
  /** Viewer holds otp-logs.write → may Reveal a code with the key phrase. */
  canReveal?: boolean;
}) {
  const [rows, setRows] = useState<OtpLogRow[]>(initialRows);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(polling ? new Date() : null);
  const [newCount, setNewCount] = useState(0);
  const [online, setOnline] = useState(true);
  const knownIds = useRef<Set<string>>(new Set(initialRows.map((r) => r.id)));

  useEffect(() => {
    knownIds.current = new Set(initialRows.map((r) => r.id));
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    async function tick() {
      try {
        const sinceAt = rows[0]?.createdAt
          ? new Date(rows[0].createdAt).toISOString()
          : undefined;
        const qs = new URLSearchParams();
        if (sinceAt) qs.set("since_at", sinceAt);
        if (filterParams.phone) qs.set("phone", filterParams.phone);
        if (filterParams.purpose) qs.set("purpose", filterParams.purpose);
        if (filterParams.event) qs.set("event", filterParams.event);
        if (filterParams.since) qs.set("since", filterParams.since);
        const r = await fetch(`/api/admin/data/otp-logs?${qs}`, { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) {
          setOnline(false);
          return;
        }
        setOnline(true);
        const data = (await r.json()) as { rows: OtpLogRow[] };
        const fresh = data.rows.filter((r) => !knownIds.current.has(r.id));
        if (fresh.length > 0) {
          for (const r of fresh) knownIds.current.add(r.id);
          setRows((prev) => [...fresh, ...prev].slice(0, 200));
          setNewCount((n) => n + fresh.length);
        }
        setLastRefreshedAt(new Date());
      } catch {
        if (!cancelled) setOnline(false);
      }
    }
    const interval = setInterval(tick, 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [polling, filterParams.phone, filterParams.purpose, filterParams.event, filterParams.since, rows]);

  // Tick the "x seconds ago" label even when no new data arrives.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [polling]);

  const ageSec = lastRefreshedAt
    ? Math.max(0, Math.floor((Date.now() - lastRefreshedAt.getTime()) / 1000))
    : null;

  return (
    <div>
      {polling ? (
        <div className="mb-3 flex items-center justify-between text-[12.5px]">
          <div className="flex items-center gap-2">
            {online ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-700 border border-emerald-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
                <Wifi className="h-3 w-3 ml-0.5" />
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 font-medium text-red-700 border border-red-200">
                <WifiOff className="h-3 w-3" />
                Connection lost
              </span>
            )}
            <span className="text-ink-500">
              {ageSec !== null ? `last refreshed ${ageSec}s ago` : "—"}
            </span>
          </div>
          {newCount > 0 ? (
            <button
              type="button"
              onClick={() => setNewCount(0)}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-[12px] font-medium text-brand-700 border border-brand-200 hover:bg-brand-100"
            >
              +{newCount} since you opened this page
            </button>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No OTP logs found"
          description="OTP send and verify events will appear here."
        />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Phone</Th>
              <Th>Purpose</Th>
              <Th>Event</Th>
              <Th>OTP Sent</Th>
              <Th>Transaction ID</Th>
              <Th>Error</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td muted>
                  <span className="text-[12px] tabular-nums">
                    {new Date(r.createdAt).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-[13px]">+91 {r.phone}</span>
                </Td>
                <Td muted>
                  <span className="text-[12px]">{purposeLabel(r.purpose)}</span>
                </Td>
                <Td>{eventBadge(r.event)}</Td>
                <Td>
                  <OtpCodeCell row={r} canReveal={canReveal} />
                </Td>
                <Td muted>
                  <span className="font-mono text-[11px]">{r.transactionId ?? "—"}</span>
                </Td>
                <Td>
                  {r.error ? (
                    <span className="text-[11px] text-red-500">{r.error}</span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </Td>
                <Td muted>
                  <span className="font-mono text-[11px]">{r.ip ?? "—"}</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
