"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Per-row delete control for the /admin/schools table. Calls the existing
 * `DELETE /api/admin/schools/[id]` route (gated server-side on
 * `schools.write`) and refreshes the list. The list page only renders this
 * when the viewer has `schools.write`, so a school_admin viewer never sees
 * the trash icon.
 */
export function SchoolRowActions({
  schoolId,
  schoolLabel,
}: {
  schoolId: string;
  schoolLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onDelete = () => {
    if (
      !confirm(
        `Delete "${schoolLabel}"?\n\nStudents, coordinators and orders linked to this school will be affected.`,
      )
    )
      return;
    start(async () => {
      setErr(null);
      const res = await fetch(`/api/admin/schools/${schoolId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? `Delete failed (${res.status})`);
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        title="Delete school"
        aria-label={`Delete ${schoolLabel}`}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {err ? (
        <span className="text-[11px] text-red-600" title={err}>
          {err.slice(0, 40)}
        </span>
      ) : null}
    </div>
  );
}
