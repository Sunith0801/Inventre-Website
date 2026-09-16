import { db } from "@/db/client";
import { notificationRules } from "@/db/schema";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/admin/ui/primitives";
import { NotificationRulesEditor } from "@/components/admin/NotificationRulesEditor";

export const dynamic = "force-dynamic";

export default async function NotificationsRulesPage() {
  const rules = await db
    .select()
    .from(notificationRules)
    .orderBy(desc(notificationRules.createdAt));

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="System Configuration"
        title="Notification rules"
      />
      <NotificationRulesEditor
        initial={rules.map((r) => ({
          id: r.id,
          name: r.name,
          eventType: r.eventType,
          channel: r.channel,
          recipientType: r.recipientType,
          templateId: r.templateId,
          subject: r.subject,
          bodyTemplate: r.bodyTemplate,
          enabled: r.enabled,
        }))}
      />
    </div>
  );
}
