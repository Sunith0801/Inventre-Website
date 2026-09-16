"use client";

import { useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Field, Input, Select, FormGrid, FormError } from "@/components/admin/ui/primitives";
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

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

/**
 * The per-row website-access control on the MCB dashboard. Granted rows
 * read as one line ("✓ Granted 30 May 2026 · Revoke"); the who/when detail
 * is in the tooltip so a 100-row page stays a table, not a list of cards.
 */
export default function GrantAccessButton(props: Props) {
  const { enrolmentNumber, defaults, granted, grantedAt, grantedBy, onChange } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = `mcb-${enrolmentNumber.replace(/[^a-zA-Z0-9]/g, "")}`;

  if (granted) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap" title={grantedBy ? `Granted ${fmt(grantedAt)} by ${grantedBy}` : undefined}>
        <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Granted
          {grantedAt ? <span className="font-normal text-ink-500">{fmt(grantedAt)}</span> : null}
        </span>
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
          <button type="submit" disabled={pending} className="text-[12px] font-medium text-ink-400 hover:text-red-600 disabled:opacity-50">
            {pending ? "Revoking…" : "Revoke"}
          </button>
        </form>
        {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
      </div>
    );
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => dialogRef.current?.showModal()}>
        Grant access
      </Button>
      <dialog
        ref={dialogRef}
        className="w-[520px] max-w-[92vw] rounded-2xl border border-ink-100 p-0 shadow-xl backdrop:bg-black/40"
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
          <div className="border-b border-ink-100 px-5 py-4">
            <h2 className="text-[16px] font-semibold text-ink-900">Grant website access</h2>
            <p className="mt-1 text-[12.5px] text-ink-500">
              Adds the student to the master data and creates the parent account. The parent signs in with an OTP to this mobile number.
            </p>
          </div>
          <input type="hidden" name="enrolment_number" value={enrolmentNumber} />
          <div className="px-5 py-4">
            <FormGrid cols={2}>
              <Field label="Student name" htmlFor={`${uid}-name`} required className="md:col-span-2">
                <Input id={`${uid}-name`} name="full_name" defaultValue={defaults.fullName} required />
              </Field>
              <Field label="MCB grade" htmlFor={`${uid}-mcb`} hint="As reported by MyClassBoard">
                <Input id={`${uid}-mcb`} value={defaults.mcbGrade || "—"} readOnly tabIndex={-1} className="font-semibold" />
              </Field>
              <Field label="Catalog grade" htmlFor={`${uid}-grade`} hint="Used for product targeting only">
                <Input id={`${uid}-grade`} name="grade" defaultValue={defaults.grade} placeholder="Grade 4 / Nursery" />
              </Field>
              <Field label="Section" htmlFor={`${uid}-section`}>
                <Input id={`${uid}-section`} name="section" defaultValue={defaults.section} />
              </Field>
              <Field label="Gender" htmlFor={`${uid}-gender`}>
                <Select id={`${uid}-gender`} name="gender" defaultValue={defaults.gender}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </Select>
              </Field>
              <Field label="Guardian name" htmlFor={`${uid}-parent`}>
                <Input id={`${uid}-parent`} name="parent_name" defaultValue={defaults.parentName} />
              </Field>
              <Field label="Relation" htmlFor={`${uid}-rel`}>
                <Select id={`${uid}-rel`} name="relation" defaultValue="Guardian">
                  <option value="Father">Father</option>
                  <option value="Mother">Mother</option>
                  <option value="Guardian">Guardian</option>
                </Select>
              </Field>
              <Field label="Mobile" htmlFor={`${uid}-mobile`} required hint="10 digits · the sign-in number">
                <Input id={`${uid}-mobile`} name="mobile" defaultValue={defaults.mobile} required pattern="\d{10}" inputMode="numeric" className="font-mono" />
              </Field>
              <Field label="Email" htmlFor={`${uid}-email`}>
                <Input id={`${uid}-email`} name="email" type="email" defaultValue={defaults.email} />
              </Field>
            </FormGrid>
            <FormError className="mt-4">{error}</FormError>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-cream-50/50 px-5 py-3">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
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
