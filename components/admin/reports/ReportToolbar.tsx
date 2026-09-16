import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { Toolbar } from "@/components/admin/ui/primitives";
import { DateField } from "@/components/admin/ui/date-field";

/**
 * The one date-range toolbar every report shares: From / To pills that
 * re-query on change (AutoSubmitForm flushes once both ends are picked).
 * Extra controls (a school picker, a status filter) slot in as children.
 */
export function ReportToolbar({
  action,
  from,
  to,
  requested,
  children,
}: {
  action: string;
  /** The range the report actually ran over (after defaults). */
  from: string;
  to: string;
  /** The raw ?from / ?to from the URL. */
  requested?: { from?: string; to?: string };
  children?: React.ReactNode;
}) {
  return (
    // Keyed by BOTH the range the server used and the raw URL values. The
    // form is uncontrolled and survives soft navigation. Clearing "From" on
    // a June range resolves to the same June dates, so a key of the resolved
    // range alone never changed — the input stayed blank while the report
    // quietly used 1 June. The raw values always change on a real edit.
    <AutoSubmitForm key={`${from}|${to}|${requested?.from ?? ""}|${requested?.to ?? ""}`} action={action}>
      <Toolbar>
        <DateField label="From" name="from" defaultValue={from} max={to || undefined} />
        <DateField label="To" name="to" defaultValue={to} min={from || undefined} />
        {children}
      </Toolbar>
    </AutoSubmitForm>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` query param that is a real calendar date, else "". Report
 * queries cast these straight to `date`, so `?from=abc` or `2026-02-31` used
 * to crash the page with a Postgres cast error.
 */
export function validDate(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !ISO_DATE.test(s)) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : "";
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** First and last day of the current month as YYYY-MM-DD, the default report window. */
export function currentMonthRange(): { from: string; to: string } {
  const today = new Date();
  return {
    from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

/**
 * The window a dated report runs over. No dates → the current month. One
 * date → the rest of that date's month, so clearing "From" on a June range
 * stays in June (it used to jump to the current month's 1st, leaving From
 * after To and an empty report). A reversed range is swapped.
 */
export function reportRange(sp: { from?: string | string[]; to?: string | string[] }): { from: string; to: string } {
  let from = validDate(sp.from);
  let to = validDate(sp.to);
  if (!from && !to) return currentMonthRange();
  if (!from) from = `${to.slice(0, 8)}01`;
  if (!to) {
    const [y, m] = from.split("-").map(Number);
    to = isoDay(new Date(y, m, 0));
  }
  return from <= to ? { from, to } : { from: to, to: from };
}
