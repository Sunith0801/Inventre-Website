import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default function NotificationsSettingsPage() {
  const resend = !!process.env.RESEND_API_KEY;
  const msg91 = !!process.env.MSG91_AUTH_KEY;
  const fromEmail = process.env.EMAIL_FROM ?? "noreply@inventre.in";

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Email & SMS"
        eyebrow="System Configuration"
      />

      <Card className="mb-4">
        <CardHeader title="Email (Resend)" />
        <Row
          label="API key"
          status={resend ? "configured" : "missing"}
          hint={resend ? "Set" : "Set RESEND_API_KEY"}
        />
        <Row label="From address" status="configured" hint={fromEmail} />
      </Card>

      <Card>
        <CardHeader
          title="SMS (MSG91)"
        />
        <Row
          label="Auth key"
          status={msg91 ? "configured" : "missing"}
          hint={msg91 ? "Set" : "Set MSG91_AUTH_KEY"}
        />
        <Row
          label="OTP template"
          status={process.env.MSG91_OTP_TEMPLATE_ID ? "configured" : "missing"}
          hint={process.env.MSG91_OTP_TEMPLATE_ID ?? "Set MSG91_OTP_TEMPLATE_ID"}
        />
        <Row
          label="Order status template"
          status={
            process.env.MSG91_ORDER_TEMPLATE_ID ? "configured" : "missing"
          }
          hint={
            process.env.MSG91_ORDER_TEMPLATE_ID ?? "Set MSG91_ORDER_TEMPLATE_ID"
          }
        />
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
        {hint ? (
          <div className="text-[11px] text-ink-500 mt-0.5 font-mono">{hint}</div>
        ) : null}
      </div>
      <Badge tone={status === "configured" ? "success" : "danger"} dot size="sm">
        {status === "configured" ? "Configured" : "Missing"}
      </Badge>
    </div>
  );
}
