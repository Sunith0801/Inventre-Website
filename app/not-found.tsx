/**
 * 404. Previously this was Next's default black-on-white "404 | This page
 * could not be found" — the one screen on the site that looked like nobody
 * had designed it. The most useful thing to offer someone who mistyped a
 * product URL is the way back into the shop, so that is the primary action.
 */

import { Compass } from "lucide-react";
import { Button, Container, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <Container width="narrow" className="py-24">
      <EmptyState
        icon={<Compass className="h-6 w-6" />}
        title="We couldn't find that page"
        description="The link may be out of date, or the item may no longer be listed for your school."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button href="/shop">Browse the shop</Button>
            <Button href="/" variant="ghost">
              Back to home
            </Button>
          </div>
        }
      />
    </Container>
  );
}
