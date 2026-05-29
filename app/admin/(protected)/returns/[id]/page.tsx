"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Check, X, PackageCheck, Wallet, Repeat } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
  statusTone,
} from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";

type ReturnDetail = {
  id: string;
  returnNumber: string;
  status: string;
  reason: string;
  notes: string | null;
  refundAmount: number | null;
  createdAt: string;
};

export default function ReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [ret, setRet] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/admin/returns?id=${id}`);
        if (!r.ok) {
          setLoadError(`Failed to load (HTTP ${r.status})`);
          return;
        }
        const data = await r.json();
        const found = (data.returns ?? []).find(
          (x: { ret: { id: string } }) => x.ret.id === id
        );
        if (found) {
          setRet(found.ret);
          setNotes(found.ret.notes ?? "");
          if (found.ret.refundAmount) {
            setRefundAmount(Math.round(found.ret.refundAmount / 100));
          }
        } else {
          setLoadError("Return not found");
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const act = async (
    action: "approve" | "reject" | "receive" | "refund" | "create_replacement"
  ) => {
    setBusy(true);
    setMsg(null);
    setError(null);
    const body: Record<string, unknown> = { action, notes };
    if (action === "refund") {
      body.refundAmount = refundAmount * 100;
      body.refundMethod = "original";
    }
    const r = await fetch(`/api/admin/returns/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(data.error ?? "Action failed");
    } else if (action === "create_replacement" && data.orderId) {
      router.push(`/admin/orders/${data.orderId}`);
    } else {
      setMsg(`Done · ${action.replace("_", " ")}`);
      setTimeout(() => router.refresh(), 600);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl">
        <div className="text-[14px] text-ink-500">Loading…</div>
      </div>
    );
  }
  if (!ret) {
    return (
      <div className="max-w-3xl space-y-3">
        <div className="text-[14px] text-red-700">
          {loadError ?? "Return not found"}
        </div>
        <a href="/admin/returns" className="text-[13px] text-brand-700 hover:underline">
          ← Back to Returns
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        breadcrumb={[
          { label: "Returns", href: "/admin/returns" },
          { label: ret.returnNumber },
        ]}
        title={ret.returnNumber}
        eyebrow="Return"
        description={
          <span className="flex items-center gap-2 flex-wrap">
            <Badge tone={statusTone(ret.status)} dot size="sm">
              {ret.status}
            </Badge>
            <span className="text-ink-500">Reason: {ret.reason}</span>
          </span>
        }
      />

      <Card>
        <CardHeader title="Notes" description="Visible to the customer-care team." />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 text-[13px] rounded-lg bg-white border border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition"
          rows={3}
        />
      </Card>

      <Card>
        <CardHeader title="Actions" description="Move the RMA forward." />

        <div className="flex flex-wrap items-center gap-2">
          {ret.status === "requested" && (
            <>
              <Button
                variant="primary"
                icon={<Check className="h-3.5 w-3.5" />}
                busy={busy}
                onClick={() => act("approve")}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                icon={<X className="h-3.5 w-3.5" />}
                busy={busy}
                onClick={() => act("reject")}
              >
                Reject
              </Button>
            </>
          )}

          {ret.status === "approved" && (
            <Button
              variant="primary"
              icon={<PackageCheck className="h-3.5 w-3.5" />}
              busy={busy}
              onClick={() => act("receive")}
            >
              Mark received (restock unopened)
            </Button>
          )}

          {(ret.status === "approved" ||
            ret.status === "received" ||
            ret.status === "refunded") && (
            <Button
              variant="secondary"
              icon={<Repeat className="h-3.5 w-3.5" />}
              busy={busy}
              onClick={() => act("create_replacement")}
            >
              Create replacement order
            </Button>
          )}

          {(ret.status === "received" || ret.status === "approved") && (
            <div className="flex flex-wrap items-end gap-3 ml-auto">
              <label className="block">
                <span className="text-[11px] font-semibold text-ink-700 uppercase tracking-wider">
                  Refund (₹)
                </span>
                <input
                  type="number"
                  min={0}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(Number(e.target.value))}
                  className="mt-1 px-3 h-9 w-32 text-[13px] rounded-lg bg-white border border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition tabular-nums"
                />
              </label>
              <Button
                variant="primary"
                icon={<Wallet className="h-3.5 w-3.5" />}
                busy={busy}
                onClick={() => act("refund")}
                disabled={refundAmount <= 0}
              >
                Refund + credit note
              </Button>
            </div>
          )}
        </div>
        {error ? (
          <div className="mt-3 text-[13px] text-red-700">{error}</div>
        ) : null}
        {msg ? (
          <div className="mt-3 text-[13px] text-emerald-700">{msg}</div>
        ) : null}
      </Card>
    </div>
  );
}
