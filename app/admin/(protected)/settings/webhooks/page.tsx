import { db } from "@/db/client";
import { webhookEndpoints } from "@/db/schema";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/admin/ui/primitives";
import { WebhooksEditor } from "@/components/admin/WebhooksEditor";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .orderBy(desc(webhookEndpoints.createdAt));

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="System Configuration"
        title="Outbound webhooks"
      />
      <WebhooksEditor
        initial={rows.map((r) => ({
          id: r.id,
          name: r.name,
          url: r.url,
          events: r.events ?? [],
          enabled: r.enabled,
          lastStatus: r.lastStatus,
          lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
          lastError: r.lastError,
        }))}
      />
    </div>
  );
}
