import { PageHeader, Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import { ErpSyncTrigger } from "@/components/admin/ErpSyncTrigger";
import { ErpItemFeedSyncTrigger } from "@/components/admin/ErpItemFeedSyncTrigger";

export const dynamic = "force-dynamic";

export default function ErpSyncPage() {
  const configured = !!(
    process.env.ERP_BASE_URL &&
    process.env.ERP_API_KEY &&
    process.env.ERP_API_SECRET
  );
  const feedConfigured = !!(process.env.ERP_FEED_BASE && process.env.ERP_FEED_KEY);

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        eyebrow="System Configuration"
        title="ERP sync"
      />

      {/* ──────────────────────────────────────────────────────────────
          Item feed (primary)
          ────────────────────────────────────────────────────────────── */}
      <section>
        <PageHeader
          eyebrow="System Configuration"
          title="Item feed (audit.inventre.online)"
        />

        <Card className="mb-5">
          <CardHeader title="Connection" />
          <Row
            label="ERP_FEED_BASE"
            value={process.env.ERP_FEED_BASE ? "configured" : "missing"}
            hint={process.env.ERP_FEED_BASE ?? "e.g. https://audit.inventre.online"}
          />
          <Row
            label="ERP_FEED_KEY"
            value={process.env.ERP_FEED_KEY ? "configured" : "missing"}
            hint={
              process.env.ERP_FEED_KEY
                ? `${process.env.ERP_FEED_KEY.slice(0, 8)}…`
                : "Get from the ERP backend env (rotate via INTEGRATION_API_KEY)"
            }
          />
          <Row
            label="CRON_KEY"
            value={process.env.CRON_KEY ? "configured" : "missing"}
            hint={
              process.env.CRON_KEY
                ? "Set — scheduled syncs can fire"
                : "Optional. Required for the nightly cron endpoint to work."
            }
          />
        </Card>

        {feedConfigured ? (
          <Card>
            <CardHeader
              title="Run item-feed sync"
            />
            <ErpItemFeedSyncTrigger />
          </Card>
        ) : (
          <Card>
            <p className="text-[13px] text-ink-700">
              Set <code className="font-mono text-[12px]">ERP_FEED_BASE</code> and{" "}
              <code className="font-mono text-[12px]">ERP_FEED_KEY</code> in your env, restart the
              app, then come back here to run the sync.
            </p>
          </Card>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────
          Legacy multi-doctype puller
          ────────────────────────────────────────────────────────────── */}
      <section>
      <PageHeader
        eyebrow="Legacy"
        title="Pull from ERPNext"
      />

      <Card className="mb-5">
        <CardHeader title="Connection" />
        <Row
          label="ERP_BASE_URL"
          value={process.env.ERP_BASE_URL ? "configured" : "missing"}
          hint={process.env.ERP_BASE_URL ?? "Set in .env.deploy"}
        />
        <Row
          label="ERP_API_KEY"
          value={process.env.ERP_API_KEY ? "configured" : "missing"}
          hint={
            process.env.ERP_API_KEY
              ? `${process.env.ERP_API_KEY.slice(0, 6)}…`
              : "Generate at /app/user-permission in your ERPNext"
          }
        />
        <Row
          label="ERP_API_SECRET"
          value={process.env.ERP_API_SECRET ? "configured" : "missing"}
          hint={process.env.ERP_API_SECRET ? "(hidden)" : "Companion to API key"}
        />
      </Card>

      {configured ? (
        <Card>
          <CardHeader
            title="Run sync"
          />
          <ErpSyncTrigger />
        </Card>
      ) : (
        <Card>
          <p className="text-[13px] text-ink-700">
            Drop the three env vars in <code className="font-mono text-[12px]">.env.deploy</code>,
            restart the app container, then come back here to run the pull.
          </p>
          <p className="text-[12px] text-ink-500 mt-2">
            How to get the API key:{" "}
            <span className="font-mono">
              Settings → User → New API Key
            </span>{" "}
            in your ERPNext.
          </p>
        </Card>
      )}
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: "configured" | "missing";
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-ink-100/70 last:border-0">
      <div>
        <div className="text-[13px] font-medium text-ink-900 font-mono">{label}</div>
        {hint ? (
          <div className="text-[11px] text-ink-500 mt-0.5 break-all">{hint}</div>
        ) : null}
      </div>
      <Badge tone={value === "configured" ? "success" : "danger"} dot size="sm">
        {value === "configured" ? "Configured" : "Missing"}
      </Badge>
    </div>
  );
}
