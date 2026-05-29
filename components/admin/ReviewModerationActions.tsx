"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

export function ReviewModerationActions({
  reviewId,
  status,
}: {
  reviewId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (next: "approved" | "rejected" | "pending") => {
    start(async () => {
      await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    });
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => set("approved")}
        disabled={pending || status === "approved"}
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 h-8 text-[12px] font-semibold hover:bg-emerald-100 disabled:opacity-50"
      >
        <Check className="h-3 w-3" /> Approve
      </button>
      <button
        onClick={() => set("rejected")}
        disabled={pending || status === "rejected"}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 text-red-700 px-3 h-8 text-[12px] font-semibold hover:bg-red-100 disabled:opacity-50"
      >
        <X className="h-3 w-3" /> Reject
      </button>
    </div>
  );
}
