"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";

type DupGroup = {
  phone: string;
  count: number;
  rows: Array<{
    erpName: string | null;
    guardianName: string | null;
    linkCount: number;
    syncedAt: string | null;
  }>;
};

/**
 * Renders a soft-warning card at the top of /admin/guardians when there
 * are guardians sharing a mobile number. One-click merge per group calls
 * /api/admin/data/guardians/merge-by-phone, which picks the highest-link
 * row as canonical and rewires student_guardian_links accordingly.
 *
 * Only super-admins see this banner (the server-side page check gates
 * visibility; the merge endpoint additionally enforces super).
 */
export function GuardianMergeBanner({ groups }: { groups: DupGroup[] }) {
  const router = useRouter();
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [, start] = useTransition();
  const [feedback, setFeedback] = useState<{ phone: string; msg: string; ok: boolean } | null>(null);

  if (groups.length === 0) return null;

  const totalDups = groups.reduce((s, g) => s + (g.count - 1), 0);

  function merge(phone: string) {
    setBusyPhone(phone);
    setFeedback(null);
    start(async () => {
      try {
        const r = await fetch("/api/admin/data/guardians/merge-by-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        const data = (await r.json().catch(() => null)) as
          | { ok?: boolean; kept?: string; mergedCount?: number; linksRewired?: number; error?: string }
          | null;
        if (!r.ok || !data?.ok) {
          setFeedback({ phone, ok: false, msg: data?.error ?? "Merge failed" });
        } else {
          setFeedback({
            phone,
            ok: true,
            msg: `Merged ${data.mergedCount} duplicate${data.mergedCount === 1 ? "" : "s"} into ${data.kept ?? "canonical"} (${data.linksRewired} student links rewired)`,
          });
          router.refresh();
        }
      } finally {
        setBusyPhone(null);
      }
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-amber-900">
            {groups.length} mobile number{groups.length === 1 ? "" : "s"} with duplicate guardian rows ({totalDups} extra row{totalDups === 1 ? "" : "s"})
          </div>
          <p className="mt-0.5 text-[12.5px] text-amber-800">
            Multiple `guardians.erp_name` rows share the same phone. Login resolution picks one row arbitrarily — merge to consolidate so the family logs in seamlessly. The row with the most linked students wins as canonical; non-canonical rows are deleted and their student_guardian_links re-pointed.
          </p>
          <ul className="mt-3 space-y-2">
            {groups.map((g) => (
              <li
                key={g.phone}
                className="rounded-lg border border-amber-200 bg-white/80 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-mono font-semibold text-ink-900">{g.phone}</div>
                    <div className="text-[11.5px] text-ink-600 mt-0.5">
                      {g.rows
                        .map(
                          (r) =>
                            `${r.erpName ?? "(no erp_name)"} · ${r.guardianName ?? "—"} · ${r.linkCount} link${r.linkCount === 1 ? "" : "s"}`
                        )
                        .join("  →  ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyPhone === g.phone}
                    onClick={() => merge(g.phone)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {busyPhone === g.phone ? "Merging…" : "Merge"}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                {feedback?.phone === g.phone ? (
                  <div
                    className={
                      "mt-2 inline-flex items-center gap-1 text-[12px] " +
                      (feedback.ok ? "text-emerald-700" : "text-red-700")
                    }
                  >
                    {feedback.ok ? <Check className="h-3 w-3" /> : null}
                    {feedback.msg}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
