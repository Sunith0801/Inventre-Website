/**
 * Highlighted "another request already covers this item" line, shown on a
 * rejected exchange's status banner and its "Reason from our team" card.
 *
 * Pure/presentational — no client hooks — so it renders in both the
 * server-rendered detail page and the client-side status banner. Pass the
 * already-resolved list from `resolveDuplicateOf(...)` (structured
 * duplicate_of first, RTN-from-reason fallback second).
 */

import type { DuplicateOfEntry } from "@/lib/return-duplicates";

function raisedByLabel(raisedBy: DuplicateOfEntry["raised_by"]): string | null {
  if (raisedBy === "team") return "raised by our team";
  if (raisedBy === "customer") return "raised by you";
  return null; // unknown (regex-fallback path) → omit the qualifier
}

export function DuplicateOfNote({
  dups,
  className = "",
}: {
  dups: DuplicateOfEntry[];
  className?: string;
}) {
  if (!dups || dups.length === 0) return null;

  return (
    <p
      className={
        "mt-2 rounded-lg border border-rose-200 bg-rose-100/70 px-3 py-2 text-[13px] text-rose-900 " +
        className
      }
    >
      Another request for this item already exists:{" "}
      {dups.map((d, i) => {
        const who = raisedByLabel(d.raised_by);
        return (
          <span key={d.return_number}>
            {i > 0 && ", "}
            <strong className="rounded bg-rose-200 px-1 font-bold text-rose-800">
              {d.return_number}
            </strong>
            {who ? ` (${who})` : ""}
          </span>
        );
      })}
      . That request is being processed — no further action needed on this
      one.
    </p>
  );
}
