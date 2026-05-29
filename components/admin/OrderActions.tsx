"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

export function OrderActions({
  orderId,
  hasInvoice,
}: {
  orderId: string;
  hasInvoice: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const generateInvoice = () => {
    setMsg(null);
    start(async () => {
      const r = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error ?? "Invoice generation failed");
        return;
      }
      const { id, invoiceNumber, alreadyExisted } = await r.json();
      setMsg(
        alreadyExisted
          ? `Invoice ${invoiceNumber} already existed`
          : `Created invoice ${invoiceNumber}`
      );
      router.push(`/admin/invoices/${id}/print`);
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={<FileText className="h-3.5 w-3.5" />}
          onClick={generateInvoice}
          busy={pending}
        >
          {hasInvoice ? "View / re-link invoice" : "Generate invoice"}
        </Button>
        <a href={`/admin/shipments/new?orderId=${orderId}`}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Truck className="h-3.5 w-3.5" />}
            className="w-full"
          >
            Create shipment
          </Button>
        </a>
        <a href={`/admin/returns/new?orderId=${orderId}`}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Undo2 className="h-3.5 w-3.5" />}
            className="w-full"
          >
            Start return
          </Button>
        </a>
      </div>
      {msg ? (
        <p className="text-[12px] text-ink-600">{msg}</p>
      ) : null}
    </div>
  );
}
