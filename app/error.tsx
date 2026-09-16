"use client";

/**
 * Route-segment error boundary for every storefront page.
 *
 * Until this existed a thrown error anywhere under `app/` fell through to
 * Next's built-in error screen — an unstyled page with no way back and no
 * retry, shown to a parent mid-checkout. `reset()` re-renders the segment,
 * which is enough to recover from a transient database or upstream blip
 * without a full reload.
 */

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Container, EmptyState } from "@/components/ui/primitives";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // deliberately withholds from the client in production.
    console.error("[storefront] segment error", error.digest, error);
  }, [error]);

  return (
    <Container width="narrow" className="py-24">
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Something went wrong at our end"
        description="This page didn't load. It's not something you did — try again, and if it keeps happening our team can pick it up from here."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={reset}>Try again</Button>
            <Button href="/" variant="ghost">
              Back to home
            </Button>
          </div>
        }
      />
      {error.digest ? (
        <p className="mt-8 text-center text-[11px] font-mono text-ink-400">
          Reference {error.digest}
        </p>
      ) : null}
    </Container>
  );
}
