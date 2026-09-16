"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import {
  Card,
  CardHeader,
  Badge,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";

type Rule = {
  id: string;
  name: string;
  eventType: string;
  channel: string;
  recipientType: string;
  templateId: string | null;
  subject: string | null;
  bodyTemplate: string | null;
  enabled: boolean;
};

const EVENTS = [
  "order.placed",
  "order.confirmed",
  "order.cancelled",
  "order.shipped",
  "order.delivered",
  "shipment.created",
  "invoice.created",
  "return.requested",
  "return.refunded",
  "stock.low",
];

export function NotificationRulesEditor({ initial }: { initial: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [draft, setDraft] = useState({
    name: "",
    eventType: "order.confirmed",
    channel: "email" as "email" | "sms" | "push",
    recipientType: "customer" as "customer" | "admin" | "school",
    templateId: "",
    subject: "",
    bodyTemplate: "",
    enabled: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!draft.name.trim()) {
      setError("Name required");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/notification-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          eventType: draft.eventType,
          channel: draft.channel,
          recipientType: draft.recipientType,
          templateId: draft.templateId || null,
          subject: draft.subject || null,
          bodyTemplate: draft.bodyTemplate || null,
          enabled: draft.enabled,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setRules([data.rule, ...rules]);
      setDraft({ ...draft, name: "", subject: "", bodyTemplate: "" });
      router.refresh();
    });
  };

  const toggle = async (rule: Rule) => {
    await fetch(`/api/admin/notification-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
  };

  const remove = async (rule: Rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await fetch(`/api/admin/notification-rules/${rule.id}`, { method: "DELETE" });
    setRules(rules.filter((r) => r.id !== rule.id));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Add a rule"
        />
        <form
          onSubmit={create}
          className="grid grid-cols-1 lg:grid-cols-2 gap-3"
        >
          <Field label="Name" required>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
              placeholder="e.g. Order confirmed SMS"
              className={inputClass}
            />
          </Field>
          <Field label="Event">
            <select
              value={draft.eventType}
              onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}
              className={inputClass}
            >
              {EVENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <select
              value={draft.channel}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  channel: e.target.value as typeof draft.channel,
                })
              }
              className={inputClass}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="push">Push</option>
            </select>
          </Field>
          <Field label="Recipient">
            <select
              value={draft.recipientType}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recipientType: e.target.value as typeof draft.recipientType,
                })
              }
              className={inputClass}
            >
              <option value="customer">Customer</option>
              <option value="admin">Admin</option>
              <option value="school">School</option>
            </select>
          </Field>
          <Field label="Template ID (provider)" hint="e.g. MSG91 template ID">
            <input
              value={draft.templateId}
              onChange={(e) => setDraft({ ...draft, templateId: e.target.value })}
              className={inputClass + " font-mono"}
              placeholder="optional"
            />
          </Field>
          <Field label="Subject (email only)">
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className={inputClass}
              placeholder="Your order {{orderNumber}} is confirmed"
            />
          </Field>
          <Field label="Body template" className="lg:col-span-2">
            <textarea
              value={draft.bodyTemplate}
              onChange={(e) =>
                setDraft({ ...draft, bodyTemplate: e.target.value })
              }
              rows={3}
              className={inputClass + " py-2 h-auto"}
              placeholder="Hi {{customerName}}, order {{orderNumber}} for ₹{{total}} is confirmed."
            />
          </Field>
          <div className="lg:col-span-2 flex items-center justify-end gap-3">
            {error ? (
              <span className="text-[13px] text-red-700">{error}</span>
            ) : null}
            <Button busy={pending} icon={<Plus className="h-3.5 w-3.5" />} type="submit">
              Add rule
            </Button>
          </div>
        </form>
      </Card>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
          <CardHeader
            title="Configured rules"
            description={`${rules.length} rule${rules.length === 1 ? "" : "s"}`}
          />
        </div>
        {rules.length === 0 ? (
          <EmptyState title="No rules yet" description="Add your first above." />
        ) : (
          <ul className="divide-y divide-ink-100/70">
            {rules.map((r) => (
              <li
                key={r.id}
                className="px-5 lg:px-6 py-3 flex items-start gap-4 hover:bg-cream-50/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px]">{r.name}</span>
                    <Badge tone="subtle" size="sm">
                      {r.eventType}
                    </Badge>
                    <Badge
                      tone={r.channel === "sms" ? "violet" : "info"}
                      size="sm"
                    >
                      {r.channel}
                    </Badge>
                    <Badge tone="default" size="sm">
                      → {r.recipientType}
                    </Badge>
                  </div>
                  {r.subject ? (
                    <div className="text-[12px] text-ink-700 mt-1 truncate">
                      {r.subject}
                    </div>
                  ) : null}
                  {r.bodyTemplate ? (
                    <div className="text-[11px] text-ink-500 mt-0.5 line-clamp-2">
                      {r.bodyTemplate}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggle(r)}
                    className={
                      "px-2.5 py-1 text-[11px] font-semibold rounded-lg " +
                      (r.enabled
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-ink-100 text-ink-500")
                    }
                  >
                    {r.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r)}
                    className="text-ink-400 hover:text-red-600 p-1"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
