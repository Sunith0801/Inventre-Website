"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, UserMinus } from "lucide-react";
import { Button, Field, Input } from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";

/**
 * Destructive admin action — calls
 * `POST /api/admin/data/students/[id]/unlink`, which disables the
 * student and detaches it from the currently-linked parent + deletes
 * the guardian links carrying that parent's phone.
 *
 * It is the most consequential button on the student record, so it opens
 * a dialog that spells out exactly what changes on the parent's side and
 * makes the operator type REMOVE — a misfired click can't break a family.
 */
export function RemoveFromFamilyButton({
  studentId,
  studentName,
  parentLabel,
}: {
  studentId: string;
  studentName: string;
  /** "Mohammad Imran · 9959156229" — who the student is being detached from. */
  parentLabel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const armed = typed.trim().toUpperCase() === "REMOVE";

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setErr(null);
  };

  function run() {
    if (!armed) return;
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/unlink`, { method: "POST" });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        setErr(data?.error ?? `Could not remove (HTTP ${r.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        icon={<UserMinus className="h-3.5 w-3.5" />}
        onClick={() => setOpen(true)}
      >
        Remove from family
      </Button>

      {open ? (
        <Dialog
          open
          onClose={close}
          title="Remove this student from the family?"
          description={
            parentLabel
              ? `${studentName} will be detached from ${parentLabel}.`
              : `${studentName} will be detached from its parent account.`
          }
          busy={busy}
          width="sm"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={busy}
                disabled={!armed}
                onClick={run}
                icon={<UserMinus className="h-3.5 w-3.5" />}
              >
                Remove from family
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <ul className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-4 text-[13px] text-red-900">
              <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> The parent stops seeing this student on the website straight away.</li>
              <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> The student is switched off and blocked until an admin re-enables it and adds a guardian again.</li>
              <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> The parent&apos;s mobile is removed from this student&apos;s guardians; siblings are not affected.</li>
            </ul>
            <p className="text-[12.5px] text-ink-600">
              Orders, cart and history are kept, and the change is written to the student&apos;s history so it can be traced.
            </p>
            <Field label="Type REMOVE to confirm" htmlFor="unlink-confirm" required>
              <Input
                id="unlink-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="REMOVE"
                autoComplete="off"
                autoFocus
                className="font-mono uppercase"
              />
            </Field>
            {err ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700">
                {err}
              </div>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
