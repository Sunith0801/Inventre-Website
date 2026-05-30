"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui/primitives";
import { grantMcbAccess, revokeMcbAccess } from "./actions";

type Props = {
  enrolmentNumber: string;
  defaults: {
    fullName: string;
    grade: string;
    mcbGrade: string;
    section: string;
    gender: "Male" | "Female" | "";
    mobile: string;
    email: string;
    parentName: string;
  };
  granted: boolean;
  grantedAt: string | null;
  grantedBy: string | null;
  onChange?: () => void;
};

const FIELD =
  "h-9 w-full px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white";
const LABEL = "block text-[11px] font-medium text-ink-500 mb-1";

export default function GrantAccessButton(props: Props) {
  const { enrolmentNumber, defaults, granted, grantedAt, grantedBy, onChange } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (granted) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700 font-medium">
          ✓ Granted{grantedAt ? ` · ${new Date(grantedAt).toLocaleDateString("en-IN")}` : ""}
        </span>
        {grantedBy && (
          <span className="text-[11px] text-ink-400">by {grantedBy}</span>
        )}
        <form
          action={(fd) => {
            if (!window.confirm(`Revoke website access for ${defaults.fullName || enrolmentNumber}? The parent will be signed out and lose access until you re-grant.`)) return;
            startTransition(async () => {
              const r = await revokeMcbAccess(fd);
              if (!r.ok) setError(r.error);
              else onChange?.();
            });
          }}
        >
          <input type="hidden" name="enrolment_number" value={enrolmentNumber} />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Revoking…" : "Revoke"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <>
      <Button variant="primary" onClick={() => dialogRef.current?.showModal()}>
        Grant access…
      </Button>
      <dialog
        ref={dialogRef}
        className="rounded-2xl shadow-xl border border-ink-100 p-0 backdrop:bg-black/40 w-[480px] max-w-[92vw]"
      >
        <form
          action={(fd) => {
            startTransition(async () => {
              setError(null);
              const r = await grantMcbAccess(fd);
              if (r.ok) {
                dialogRef.current?.close();
                onChange?.();
              } else {
                setError(r.error);
              }
            });
          }}
        >
          <div className="px-5 py-4 border-b border-ink-100">
            <div className="text-[11px] uppercase tracking-wide text-ink-500">MCB</div>
            <h2 className="text-base font-semibold text-ink-900">Grant website access</h2>
            <p className="text-[12px] text-ink-500 mt-1">
              Promote this student to the master data. A parent account is
              created (status <i>pending</i>); the parent logs in via OTP at <code>/login</code>.
            </p>
          </div>
          <input type="hidden" name="enrolment_number" value={enrolmentNumber} />
          <div className="px-5 py-4 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>Student name</label>
              <input name="full_name" className={FIELD} defaultValue={defaults.fullName} required />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>MCB grade (from API)</label>
              <input
                className={`${FIELD} bg-cream-50 text-ink-700 font-semibold`}
                value={defaults.mcbGrade || "—"}
                readOnly
                tabIndex={-1}
              />
              <details className="mt-1.5">
                <summary className="text-[11px] text-ink-400 cursor-pointer hover:text-ink-600 select-none">
                  Internal catalog grade ({defaults.grade || "—"})
                </summary>
                <div className="mt-1.5 rounded-md border border-ink-100 bg-cream-50/40 p-2">
                  <input
                    name="grade"
                    className={FIELD}
                    defaultValue={defaults.grade}
                    placeholder="Grade 4 / Grade 1 / Nursery"
                  />
                  <p className="mt-1 text-[10.5px] leading-snug text-ink-500">
                    Used only for catalog product targeting (+3 offset from
                    MCB). Parents see the school label from
                    <code>school_grade_mappings</code>, not this value.
                  </p>
                </div>
              </details>
            </div>
            <div>
              <label className={LABEL}>Section</label>
              <input name="section" className={FIELD} defaultValue={defaults.section} />
            </div>
            <div>
              <label className={LABEL}>Gender</label>
              <select name="gender" className={FIELD} defaultValue={defaults.gender}>
                <option value="">—</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Guardian name</label>
              <input name="parent_name" className={FIELD} defaultValue={defaults.parentName} />
            </div>
            <div>
              <label className={LABEL}>Relation</label>
              <select name="relation" className={FIELD} defaultValue="Guardian">
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Guardian">Guardian</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Mobile (10 digits)</label>
              <input
                name="mobile"
                className={FIELD}
                defaultValue={defaults.mobile}
                required
                pattern="\d{10}"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className={LABEL}>Email</label>
              <input name="email" type="email" className={FIELD} defaultValue={defaults.email} />
            </div>
          </div>
          {error && (
            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-[12px]">
              {error}
            </div>
          )}
          <div className="px-5 py-3 border-t border-ink-100 flex items-center justify-end gap-2 bg-cream-50/50">
            <Button
              type="button"
              variant="secondary"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Granting…" : "Grant access"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
