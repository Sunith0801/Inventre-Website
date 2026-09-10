import { PageHeader, Card, CardHeader } from "@/components/admin/ui/primitives";
import { getOtpToggles } from "@/server/otp-toggles";
import { OtpTogglesForm } from "./toggles-form";

export const dynamic = "force-dynamic";

export default async function OtpSettingsPage() {
  const toggles = await getOtpToggles();
  const bypassConfigured = !!process.env.OTP_BYPASS_CODE;

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Settings", href: "/admin/settings" },
          { label: "OTP delivery" },
        ]}
        title="OTP delivery"
        eyebrow="Settings"
        description="Toggle real SMS and email/SMTP OTP sending. When a channel is off, OTPs for that channel fall back to a fixed bypass code from the deploy env."
      />

      <Card className="mb-4">
        <CardHeader
          title="Channels"
          description="Toggles apply immediately on save — no redeploy needed."
        />
        <OtpTogglesForm initial={toggles} />
      </Card>

      <Card>
        <CardHeader
          title="Bypass code"
          description="Fixed OTP returned when a channel is OFF. Stored only in .env.deploy (OTP_BYPASS_CODE)."
        />
        <div className="text-[13px] text-ink-700">
          {bypassConfigured ? (
            <span>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-2" />
              Configured. The value itself is never shown in this UI or in
              source code.
            </span>
          ) : (
            <span className="text-red-600">
              OTP_BYPASS_CODE is not set in the deploy env. Bypass mode will
              return an error to the user.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
