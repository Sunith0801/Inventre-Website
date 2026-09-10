import { desc } from "drizzle-orm";
import { Activity } from "lucide-react";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  EmptyState,
  Badge,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function ActivityLogPage() {
  const guard = await requireAnyPermission("activity.read", "activity.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        eyebrow="Audit"
        title="Activity log"
        description={`${rows.length} most recent admin actions · who did what when`}
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Every admin write — product update, order confirm, refund — will appear here."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Summary</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td muted>
                    <span className="text-[12px]">
                      {new Date(r.createdAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px]">
                      {r.actorEmail ?? r.actorId?.slice(0, 8) ?? "system"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone="info" size="sm">
                      {r.action}
                    </Badge>
                  </Td>
                  <Td muted>
                    <span className="font-mono text-[12px]">
                      {r.entityType}
                      {r.entityId ? `#${r.entityId.slice(0, 8)}` : ""}
                    </span>
                  </Td>
                  <Td>{r.summary ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
