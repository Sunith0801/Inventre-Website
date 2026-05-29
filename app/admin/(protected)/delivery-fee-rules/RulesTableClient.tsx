"use client";

import { useRef } from "react";
import { Button } from "@/components/admin/ui/primitives";
import { RuleFormDialog, type RuleFormDialogHandle, type RuleFormInitial } from "./RuleFormDialog";

const EMPTY: RuleFormInitial = {
  school: "",
  is_active: true,
  min_amount: 0,
  max_amount: 0,
  delivery_fee: 0,
  applicable_item_groups: [],
  grade: "",
};

export function NewRuleButton({
  schools,
  grades,
}: {
  schools: string[];
  grades: string[];
}) {
  const ref = useRef<RuleFormDialogHandle>(null);
  return (
    <>
      <Button variant="primary" onClick={() => ref.current?.open(EMPTY)}>
        New rule
      </Button>
      <RuleFormDialog ref={ref} schools={schools} grades={grades} />
    </>
  );
}

/** Edit + Delete cell. Owns its own dialog instance so each row's modal
 *  prefills independently — simpler than threading a single global ref. */
export function RuleRowActions({
  initial,
  schools,
  grades,
  onDelete,
}: {
  initial: RuleFormInitial;
  schools: string[];
  grades: string[];
  onDelete: React.ReactNode;
}) {
  const ref = useRef<RuleFormDialogHandle>(null);
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => ref.current?.open(initial)}>
        Edit
      </Button>
      {onDelete}
      <RuleFormDialog ref={ref} schools={schools} grades={grades} />
    </div>
  );
}
