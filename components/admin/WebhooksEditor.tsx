"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Copy } from "lucide-react";
import {
  Card,
  CardHeader,
  Badge,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";

type Endpoint = {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
  lastError: string | null;
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

export function WebhooksEditor({ initial }: { initial: Endpoint[] }) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState(initial);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(EVENTS));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !url.trim()) {
      setError("Name and URL required");
      return;
    }
    if (picked.size === 0) {
      setError("Pick at least one event");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          events: Array.from(picked),
          enabled: true,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setEndpoints([data.endpoint, ...endpoints]);
      setName("");
      setUrl("");
      setRevealedSecret(data.secret);
      router.refresh();
    });
  };

  const toggle = async (ep: Endpoint) => {
    await fetch(`/api/admin/webhooks/${ep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !ep.enabled }),
    });
    setEndpoints(
      endpoints.map((x) => (x.id === ep.id ? { ...x, enabled: !x.enabled } : x))
    );
  };

  const remove = async (ep: Endpoint) => {
    if (!confirm(`Delete webhook "${ep.name}"?`)) return;
    await fetch(`/api/admin/webhooks/${ep.id}`, { method: "DELETE" });
    setEndpoints(endpoints.filter((x) => x.id !== ep.id));
  };

  const togglePick = (ev: string) => {
    const next = new Set(picked);
    if (next.has(ev)) next.delete(ev);
    else next.add(ev);
    setPicked(next);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Add an endpoint"
        />
        <form onSubmit={create} className="space-y-3">
          <Field label="Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. ERPNext mirror"
              className={inputClass}
            />
          </Field>
          <Field label="URL" required>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://erpnext.example.com/api/method/inventre.webhook"
              className={inputClass + " font-mono"}
            />
          </Field>
          <Field label="Events">
            <div className="flex flex-wrap gap-1.5">
              {EVENTS.map((ev) => (
                <button
                  key={ev}
                  type="button"
                  onClick={() => togglePick(ev)}
                  className={
                    "px-2.5 py-1 text-[11px] font-semibold rounded-lg transition " +
                    (picked.has(ev)
                      ? "bg-ink-900 text-white"
                      : "bg-cream-100 text-ink-600 hover:bg-cream-200")
                  }
                >
                  {ev}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center justify-end gap-3 pt-2">
            {error ? (
              <span className="text-[13px] text-red-700">{error}</span>
            ) : null}
            <Button busy={pending} icon={<Plus className="h-3.5 w-3.5" />} type="submit">
              Create webhook
            </Button>
          </div>
        </form>
      </Card>

      {revealedSecret ? (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardHeader
            title="Signing secret — copy now"
            description="This is shown ONCE. Treat it like a password and store it in your receiver's env."
          />
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12px] bg-white border border-ink-200 rounded px-2 py-1 flex-1 break-all">
              {revealedSecret}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(revealedSecret)}
              className="px-2 h-9 rounded-lg bg-ink-900 text-white text-[12px] inline-flex items-center gap-1"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRevealedSecret(null)}
              className="px-2 h-9 rounded-lg border border-ink-200 text-[12px]"
            >
              Hide
            </button>
          </div>
        </Card>
      ) : null}

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
          <CardHeader
            title="Endpoints"
            description={`${endpoints.length} configured`}
          />
        </div>
        {endpoints.length === 0 ? (
          <EmptyState title="No webhooks yet" description="Add one above." />
        ) : (
          <ul className="divide-y divide-ink-100/70">
            {endpoints.map((ep) => (
              <li
                key={ep.id}
                className="px-5 lg:px-6 py-3 flex items-start gap-4 hover:bg-cream-50/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px]">{ep.name}</span>
                    {ep.lastStatus != null ? (
                      <Badge
                        tone={
                          ep.lastStatus >= 200 && ep.lastStatus < 300
                            ? "success"
                            : "danger"
                        }
                        size="sm"
                      >
                        {ep.lastStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="font-mono text-[12px] text-ink-700 mt-0.5 truncate">
                    {ep.url}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ep.events.slice(0, 6).map((e) => (
                      <Badge key={e} tone="subtle" size="sm">
                        {e}
                      </Badge>
                    ))}
                    {ep.events.length > 6 ? (
                      <Badge tone="default" size="sm">
                        +{ep.events.length - 6}
                      </Badge>
                    ) : null}
                  </div>
                  {ep.lastError ? (
                    <div className="text-[11px] text-red-700 mt-1 truncate">
                      {ep.lastError}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggle(ep)}
                    className={
                      "px-2.5 py-1 text-[11px] font-semibold rounded-lg " +
                      (ep.enabled
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-ink-100 text-ink-500")
                    }
                  >
                    {ep.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(ep)}
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
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
