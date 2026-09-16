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
        title="OTP delivery"
        eyebrow="System Configuration"
      />

      <Card className="mb-4">
        <CardHeader
          title="Channels"
        />
        <OtpTogglesForm initial={toggles} />
      </Card>

      <Card>
        <CardHeader
          title="Bypass code"
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
