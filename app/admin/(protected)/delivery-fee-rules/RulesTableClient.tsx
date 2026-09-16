"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Button, Menu } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";
import { RuleFormDialog, type RuleFormDialogHandle, type RuleFormInitial } from "./RuleFormDialog";
import { deleteRule } from "./actions";

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
      <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => ref.current?.open(EMPTY)}>
        New rule
      </Button>
      <RuleFormDialog ref={ref} schools={schools} grades={grades} />
    </>
  );
}

/** Row menu: Edit opens the prefilled form; Delete asks first. Each row
 *  owns its own dialog instance so prefill never leaks between rows. */
export function RuleRowActions({
  initial,
  schools,
  grades,
}: {
  initial: RuleFormInitial & { name: string };
  schools: string[];
  grades: string[];
}) {
  const router = useRouter();
  const ref = useRef<RuleFormDialogHandle>(null);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    setErr(null);
    const fd = new FormData();
    fd.append("name", initial.name);
    start(async () => {
      const r = await deleteRule(fd);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setConfirm(false);
      router.refresh();
    });
  };

  return (
    <>
      <Menu
        label={`Actions for ${initial.name}`}
        items={[
          { label: "Edit rule", icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => ref.current?.open(initial) },
          { kind: "separator" },
          { label: "Delete rule", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => setConfirm(true) },
        ]}
      />
      <RuleFormDialog ref={ref} schools={schools} grades={grades} />
      <ConfirmDialog
        open={confirm}
        onClose={() => (pending ? undefined : setConfirm(false))}
        onConfirm={remove}
        title={`Delete rule ${initial.name}?`}
        description={`${initial.school || "This school"} stops charging this delivery fee straight away. The rule is removed from ERPNext as well.`}
        confirmLabel="Delete rule"
        busy={pending}
        error={err}
      />
    </>
  );
}
