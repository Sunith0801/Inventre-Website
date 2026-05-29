import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default function PaymentsSettingsPage() {
  const ccavenueConfigured = !!process.env.CCAVENUE_ACCESS_CODE;

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Settings", href: "/admin/settings" },
          { label: "Payments" },
        ]}
        title="Payments"
        eyebrow="Settings"
        description="Gateway configuration is sourced from environment variables. Rotate keys via the deployment pipeline."
      />

      <Card className="mb-4">
        <CardHeader
          title="CCAvenue"
          description="Online payment gateway used for parent checkout."
        />
        <Row
          label="API keys"
          status={ccavenueConfigured ? "configured" : "missing"}
          hint={
            ccavenueConfigured
              ? "CCAvenue keys present"
              : "Set CCAVENUE_ACCESS_CODE, CCAVENUE_WORKING_KEY, CCAVENUE_MERCHANT_ID"
          }
        />
      </Card>

      <Card>
        <CardHeader
          title="Offline methods"
          description="Available on the admin walk-in order screen."
        />
        <div className="flex flex-wrap gap-2">
          {["cash", "upi", "card", "netbanking", "bank_transfer", "cheque", "other"].map(
            (m) => (
              <Badge key={m} tone="subtle" size="md" className="capitalize">
                {m.replace("_", " ")}
              </Badge>
            )
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({
  label,
  status,
  hint,
}: {
  label: string;
  status: "configured" | "missing";
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-ink-100/70 last:border-0">
      <div>
        <div className="text-[13px] font-medium text-ink-900">{label}</div>
        {hint ? <div className="text-[11px] text-ink-500 mt-0.5">{hint}</div> : null}
      </div>
      <Badge tone={status === "configured" ? "success" : "danger"} dot size="sm">
        {status === "configured" ? "Configured" : "Missing"}
      </Badge>
    </div>
  );
}
