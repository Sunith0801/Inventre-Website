import {
  ShieldCheck,
  Truck,
  KeyRound,
  Mail,
  History,
  Bell,
  Webhook,
  RefreshCw,
  MessageSquare,
  Activity,
  Users,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { getCurrentUser } from "@/server/session";
import { canSeePage } from "@/lib/admin-permissions";
import { PageHeader } from "@/components/admin/ui/primitives";
import { ModuleGroup, type ModuleCard } from "@/components/admin/ModuleCards";
import { StatusStrip, type StatusItem } from "@/components/admin/StatusStrip";
import { getSystemStatus } from "@/server/admin/system-status";

export const dynamic = "force-dynamic";

/**
 * System Configuration hub. Every card names the permission slug its own
 * layout gates on, so an admin only sees doors they can open, and each
 * card carries a live status pill so "is SMS actually sending?" is answered
 * here instead of one click deeper.
 */
export default async function SettingsIndex() {
  const guard = await requireAnyPermission(
    "settings-users.read", "settings-users.write",
    "settings-otp.read", "settings-otp.write",
    "settings-erp-bridge.read", "settings-erp-bridge.write",
    "roles.read", "roles.write",
    "payments.read", "payments.write",
    "shipments.read", "shipments.write",
    "order-notifications.read", "order-notifications.write",
  );
  if (isResponse(guard)) redirect("/admin/dashboard");

  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") redirect("/admin/login");
  const can = (slug: string) => canSeePage(me.permissions, slug);

  const s = await getSystemStatus();

  const strip: StatusItem[] = [
    { label: "Database", probe: s.db, detail: s.db === "ok" ? "connected" : "unreachable" },
    { label: "Cache", probe: s.redis, detail: s.redis === "ok" ? "connected" : "unreachable" },
  ];
  if (can("settings-erp-bridge")) {
    strip.push({
      label: "ERP bridge",
      probe: s.erp.probe,
      href: "/admin/settings/erp-bridge",
      detail: !s.erp.bridge
        ? "not configured"
        : s.erp.dlq + s.erp.failed > 0
          ? `${s.erp.dlq + s.erp.failed} failed`
          : s.erp.pending > 0
            ? `${s.erp.pending} queued`
            : `${s.erp.target} · idle`,
    });
  }
  if (can("settings-otp")) {
    strip.push(
      {
        label: "SMS",
        probe: s.sms.probe,
        href: "/admin/settings/otp",
        detail: !s.sms.configured ? "no gateway" : s.sms.realSend ? "sending" : "muted",
      },
      {
        label: "Email",
        probe: s.email.probe,
        href: "/admin/settings/otp",
        detail: !s.email.configured ? "no provider" : s.email.realSend ? `via ${s.email.via}` : "muted",
      },
    );
  }
  if (can("payments")) {
    strip.push({
      label: "CCAvenue",
      probe: s.ccavenue,
      href: "/admin/settings/payments",
      detail: s.ccavenue === "ok" ? "keys present" : "keys missing",
    });
  }

  const commerce: ModuleCard[] = [];
  if (can("shipments"))
    commerce.push({
      label: "Shipping",
      href: "/admin/settings/shipping",
      icon: Truck,
      description: "Flat rate, free-shipping threshold and the courier list.",
    });
  if (can("payments"))
    commerce.push({
      label: "Payments",
      href: "/admin/settings/payments",
      icon: KeyRound,
      description: "CCAvenue gateway keys and the offline methods staff may record.",
      status:
        s.ccavenue === "ok"
          ? { label: "Configured", tone: "success" }
          : { label: "Keys missing", tone: "danger" },
    });

  const comms: ModuleCard[] = [];
  if (can("settings-otp"))
    comms.push({
      label: "Messaging channels",
      href: "/admin/settings/otp",
      icon: MessageSquare,
      description: "Turn real SMS and email delivery on or off. Off logs the OTP instead of sending it.",
      status:
        !s.sms.configured && !s.email.configured
          ? { label: "No channel", tone: "danger" }
          : s.sms.realSend && s.email.realSend
            ? { label: "Live", tone: "success" }
            : { label: "Partly muted", tone: "warning" },
    });
  if (can("order-notifications")) {
    comms.push(
      {
        label: "Email & SMS providers",
        href: "/admin/settings/notifications",
        icon: Mail,
        description: "Which provider each channel uses and the sender identity.",
        status:
          s.sms.configured && s.email.configured
            ? { label: "Both set", tone: "success" }
            : s.sms.configured || s.email.configured
              ? { label: "One missing", tone: "warning" }
              : { label: "None set", tone: "danger" },
      },
      {
        label: "Notification rules",
        href: "/admin/settings/notifications-rules",
        icon: Bell,
        description: "Which order events message the parent, and on which channel.",
        status:
          s.rules.total === 0
            ? { label: "No rules", tone: "subtle" }
            : { label: `${s.rules.enabled} of ${s.rules.total} on`, tone: s.rules.enabled ? "success" : "warning" },
      },
    );
  }

  const integrations: ModuleCard[] = [];
  if (can("settings-erp-bridge")) {
    integrations.push(
      {
        label: "ERP integration",
        href: "/admin/settings/erp-bridge",
        icon: Activity,
        description: "Live outbound queue to the audit ERP, replay and dead letters.",
        status: !s.erp.bridge
          ? { label: "Not configured", tone: "subtle" }
          : s.erp.dlq + s.erp.failed > 0
            ? { label: `${s.erp.dlq + s.erp.failed} failed`, tone: "danger" }
            : s.erp.pending > 0
              ? { label: `${s.erp.pending} queued`, tone: "info" }
              : { label: "Healthy", tone: "success" },
      },
      {
        label: "ERP sync",
        href: "/admin/settings/erp-sync",
        icon: RefreshCw,
        description: "Pull items, customers and orders from the ERP on demand.",
        status: s.erp.poll ? { label: "Poll on", tone: "success" } : { label: "Poll off", tone: "subtle" },
      },
      {
        label: "Webhooks",
        href: "/admin/settings/webhooks",
        icon: Webhook,
        description: "Outbound endpoints that receive order events.",
        status:
          s.webhooks.total === 0
            ? { label: "None", tone: "subtle" }
            : s.webhooks.failing > 0
              ? { label: `${s.webhooks.failing} failing`, tone: "danger" }
              : { label: `${s.webhooks.enabled} active`, tone: "success" },
      },
    );
  }

  const access: ModuleCard[] = [];
  if (can("settings-users"))
    access.push({
      label: "Admin users",
      href: "/admin/settings/users",
      icon: Users,
      description: "Staff accounts, their role and the schools they may see.",
      status: { label: `${s.superAdmins} super admin${s.superAdmins === 1 ? "" : "s"}`, tone: s.superAdmins === 0 ? "danger" : "subtle" },
    });
  if (can("roles"))
    access.push({
      label: "Roles & permissions",
      href: "/admin/roles",
      icon: ShieldCheck,
      description: "What each role may read and change, page by page.",
    });
  if (can("activity"))
    access.push({
      label: "Audit log",
      href: "/admin/activity",
      icon: History,
      description: "Every admin action, who did it and what changed.",
    });

  return (
    <div>
      <PageHeader
        eyebrow="System Configuration"
        title="Settings"
        description="How the store talks to the outside world — payments, messaging, the ERP — and who may change it."
      />
      <StatusStrip items={strip} />
      <ModuleGroup title="Commerce" description="What a parent pays and how the parcel gets there." items={commerce} />
      <ModuleGroup title="Communications" description="Every message the store sends, and whether it is really sending." items={comms} />
      <ModuleGroup title="Integrations" description="The ERP bridge and anything else listening for order events." items={integrations} />
      <ModuleGroup title="Access & audit" description="Who can get in, what they may touch, and the record of it." items={access} />
    </div>
  );
}
