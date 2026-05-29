"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, X, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";
import { bulkExtendExpiry } from "./actions";

type SchoolOption = { erpName: string; name: string };

export function BulkExtendDialog({ schools }: { schools: SchoolOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        onClick={() => setOpen(true)}
      >
        Extend expiry
      </Button>
      {open ? <Modal schools={schools} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Modal({
  schools,
  onClose,
}: {
  schools: SchoolOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [schoolErpName, setSchoolErpName] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [newEnd, setNewEnd] = useState(toLocalInput(addDays(new Date(), 30)));
  const [count, setCount] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; updated: number }
    | { ok: false; error: string }
    | null
  >(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live "this will affect N coupons" count. Re-runs as the admin tweaks
  // any filter. Debounced 250 ms so typing in the prefix field doesn't
  // hammer the server.
  useEffect(() => {
    let cancelled = false;
    if (!newEnd) {
      setCount(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await bulkExtendExpiry({
          filter: {
            schoolErpName: schoolErpName || undefined,
            codePrefix: codePrefix || undefined,
          },
          newEndDatetime: new Date(newEnd).toISOString(),
          dryRun: true,
        });
        if (cancelled) return;
        if (r.ok) {
          setCount(r.matched);
          setLiveError(null);
        } else {
          setCount(null);
          setLiveError(r.error);
        }
      } catch (e) {
        if (!cancelled) {
          setCount(null);
          setLiveError(e instanceof Error ? e.message : String(e));
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [schoolErpName, codePrefix, newEnd]);

  async function apply() {
    setResult(null);
    setBusy(true);
    try {
      const r = await bulkExtendExpiry({
        filter: {
          schoolErpName: schoolErpName || undefined,
          codePrefix: codePrefix || undefined,
        },
        newEndDatetime: new Date(newEnd).toISOString(),
      });
      setResult(r);
      if (r.ok) startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const canApply = !busy && count !== null && count > 0 && !!newEnd;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-ink-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-brand-700" />
            <h2 className="text-[14px] font-bold text-ink-900">
              Extend coupon expiry
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-ink-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[12.5px] text-ink-600">
            Push the expiry date forward on existing coupons. Pick a school
            (leave blank for all), optionally narrow by code prefix, then
            set the new end date.
          </p>

          <div className="space-y-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-700 block mb-1">
                School
              </span>
              <select
                value={schoolErpName}
                onChange={(e) => setSchoolErpName(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white"
              >
                <option value="">All schools</option>
                {schools.map((s) => (
                  <option key={s.erpName} value={s.erpName}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[12px] font-semibold text-ink-700 block mb-1">
                Code starts with{" "}
                <span className="text-ink-500 font-normal">(optional)</span>
              </span>
              <input
                type="text"
                placeholder="e.g. INV"
                value={codePrefix}
                onChange={(e) =>
                  setCodePrefix(e.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase())
                }
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white font-mono"
              />
            </label>

            <label className="block">
              <span className="text-[12px] font-semibold text-ink-700 block mb-1">
                New expiry
              </span>
              <input
                type="datetime-local"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-200 px-2 text-[13px] bg-white"
              />
            </label>
          </div>

          {result?.ok ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 text-[12.5px] w-full">
              <Check className="h-3.5 w-3.5" /> Updated {result.updated} coupon
              {result.updated === 1 ? "" : "s"}.
            </div>
          ) : result && !result.ok ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-700 text-[12.5px] w-full">
              <AlertTriangle className="h-3.5 w-3.5" /> {result.error}
            </div>
          ) : liveError ? (
            <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-700 text-[12.5px] w-full">
              <AlertTriangle className="h-3.5 w-3.5" /> {liveError}
            </div>
          ) : (
            <div className="rounded-lg bg-cream-50/60 border border-ink-200 px-3 py-2 text-[12.5px]">
              {count === null ? (
                <span className="text-ink-500">Counting…</span>
              ) : count === 0 ? (
                <span className="text-ink-500">
                  No coupons match — try different filters.
                </span>
              ) : (
                <span className="text-ink-700">
                  <b className="text-ink-900">{count}</b> coupon
                  {count === 1 ? "" : "s"} will be extended.
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={apply}
              disabled={!canApply}
              icon={<CalendarClock className="h-3.5 w-3.5" />}
            >
              {busy
                ? "Extending…"
                : count && count > 0
                  ? `Extend ${count} coupon${count === 1 ? "" : "s"}`
                  : "Extend"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
