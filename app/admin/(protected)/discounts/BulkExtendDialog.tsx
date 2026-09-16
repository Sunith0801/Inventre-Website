"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, AlertTriangle } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";
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
      {open ? <ExtendDialog schools={schools} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExtendDialog({ schools, onClose }: { schools: SchoolOption[]; onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [schoolErpName, setSchoolErpName] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [newEnd, setNewEnd] = useState(toLocalInput(addDays(new Date(), 30)));
  const [count, setCount] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; updated: number } | { ok: false; error: string } | null>(null);

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
          filter: { schoolErpName: schoolErpName || undefined, codePrefix: codePrefix || undefined },
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
        filter: { schoolErpName: schoolErpName || undefined, codePrefix: codePrefix || undefined },
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
    <Dialog
      open
      onClose={onClose}
      title="Extend coupon expiry"
      description="Push the end date forward on existing coupons — all of them, one school's, or those starting with a prefix."
      busy={busy}
      width="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {result?.ok ? "Close" : "Cancel"}
          </Button>
          {!result?.ok ? (
            <Button
              type="button"
              onClick={apply}
              busy={busy}
              disabled={!canApply}
              icon={<CalendarClock className="h-3.5 w-3.5" />}
            >
              {count && count > 0 ? `Extend ${count} coupon${count === 1 ? "" : "s"}` : "Extend"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="School" htmlFor="ext-school">
          <Select id="ext-school" value={schoolErpName} onChange={(e) => setSchoolErpName(e.target.value)}>
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s.erpName} value={s.erpName}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Code starts with" htmlFor="ext-prefix">
          <Input
            id="ext-prefix"
            placeholder="Optional, e.g. INV"
            value={codePrefix}
            onChange={(e) => setCodePrefix(e.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase())}
            className="font-mono"
            autoComplete="off"
          />
        </Field>
        <Field label="New expiry" htmlFor="ext-end" required>
          <Input id="ext-end" type="datetime-local" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
        </Field>

        {result?.ok ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12.5px] font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Updated {result.updated} coupon{result.updated === 1 ? "" : "s"}.
          </div>
        ) : result && !result.ok ? (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {result.error}
          </div>
        ) : liveError ? (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {liveError}
          </div>
        ) : (
          <div className="rounded-xl border border-ink-100/70 bg-cream-50/60 px-3 py-2.5 text-[12.5px]">
            {count === null ? (
              <span className="text-ink-500">Counting…</span>
            ) : count === 0 ? (
              <span className="text-ink-500">No coupons match these filters.</span>
            ) : (
              <span className="text-ink-700">
                <b className="text-ink-900">{count}</b> coupon{count === 1 ? "" : "s"} will be extended.
              </span>
            )}
          </div>
        )}
      </div>
    </Dialog>
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
