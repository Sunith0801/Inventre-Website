import { db } from "@/db/client";
import { giftCards } from "@/db/schema";
import { desc } from "drizzle-orm";
import { Gift, Plus } from "lucide-react";
import Link from "next/link";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Stat,
  Money,
  Button,
  statusTone,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const rows = await db
    .select()
    .from(giftCards)
    .orderBy(desc(giftCards.issuedAt))
    .limit(200);

  const active = rows.filter((r) => r.status === "active");
  const totalIssued = rows.reduce((s, r) => s + r.initialBalance, 0);
  const totalActive = active.reduce((s, r) => s + r.currentBalance, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Engagement"
        title="Gift cards"
        description={`${rows.length} cards · ${active.length} active`}
        actions={
          <Link href="/admin/gift-cards/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Issue card
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Stat label="Cards issued" value={rows.length} iconTone="default" />
        <Stat
          label="Total face value"
          value={<Money paise={totalIssued} />}
          iconTone="info"
        />
        <Stat
          label="Outstanding (active)"
          value={<Money paise={totalActive} />}
          iconTone="brand"
        />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="No gift cards issued yet"
            description="Issue a card from the button above; codes are 16 chars + checksum."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Issued to</Th>
                <Th>Status</Th>
                <Th right>Initial</Th>
                <Th right>Balance</Th>
                <Th right>Expires</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <span className="font-mono text-[12px] font-semibold">
                      {r.code}
                    </span>
                  </Td>
                  <Td muted>
                    {r.issuedToEmail ? (
                      <span>{r.issuedToEmail}</span>
                    ) : r.issuedToPhone ? (
                      <span className="font-mono">{r.issuedToPhone}</span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.status)} dot size="sm">
                      {r.status}
                    </Badge>
                  </Td>
                  <Td right>
                    <Money paise={r.initialBalance} />
                  </Td>
                  <Td right>
                    <Money
                      paise={r.currentBalance}
                      className="font-semibold"
                    />
                  </Td>
                  <Td right muted>
                    {r.expiresAt
                      ? new Date(r.expiresAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
