"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Undo2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

/**
 * Approve / reject a review inline. Once decided, a single "Undo" puts it
 * back to pending rather than offering the opposite verdict — flipping
 * straight from approved to rejected is rarely what the operator means.
 */
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
  if (status !== "pending") {
    return (
      <Button variant="ghost" size="sm" busy={pending} onClick={() => set("pending")} icon={<Undo2 className="h-3.5 w-3.5" />}>
        Undo
      </Button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Button variant="primary" size="sm" busy={pending} onClick={() => set("approved")} icon={<Check className="h-3.5 w-3.5" />}>
        Approve
      </Button>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => set("rejected")} icon={<X className="h-3.5 w-3.5" />}>
        Reject
      </Button>
    </div>
  );
}
