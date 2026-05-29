"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";

/**
 * Destructive admin action — calls
 * `POST /api/admin/data/students/[id]/unlink`, which disables the
 * student and detaches it from the currently-linked parent + deletes
 * the guardian links carrying that parent's phone. Confirms in-page so
 * a misfired click can't silently break a family.
 */
export function RemoveFromFamilyButton({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function run() {
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/unlink`, {
        method: "POST",
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        setErr(data?.error ?? `Failed to unlink (HTTP ${r.status})`);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div>
        <Button
          type="button"
          variant="secondary"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          onClick={() => setConfirming(true)}
        >
          Remove from family
        </Button>
        {err ? <div className="mt-2 text-[12px] text-red-700">{err}</div> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-[13px] text-red-900">
          <div className="font-bold">Detach this student from the family?</div>
          <div className="mt-1 text-[12.5px]">
            The student will be disabled (no longer shown on the storefront)
            and the parent's phone will be removed from this student's
            guardian list. Order history is preserved. The student will not
            re-attach automatically on the next ERPNext sync.
          </div>
          {err ? <div className="mt-2 font-mono text-[12px]">{err}</div> : null}
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              busy={busy}
              onClick={run}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            >
              Yes, remove
            </Button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-semibold text-ink-700 hover:bg-cream-100 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
