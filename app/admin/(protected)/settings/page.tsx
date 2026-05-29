import { ShieldCheck, Truck, Calculator, KeyRound, Mail, History, Bell, Webhook, RefreshCw, MessageSquare } from "lucide-react";

const sections = [
  {
    title: "Admin users",
    description: "Manage staff accounts, roles, and school admins.",
    href: "/admin/settings/users",
    icon: ShieldCheck,
    available: true,
  },
  {
    title: "Shipping",
    description: "Zones, rates, free-shipping threshold.",
    href: "/admin/settings/shipping",
    icon: Truck,
    available: true,
  },
  {
    title: "Tax (GST)",
    description: "GST rates, HSN codes, and place-of-supply rules.",
    href: "/admin/tax/rates",
    icon: Calculator,
    available: true,
  },
  {
    title: "Payments",
    description: "CCAvenue configuration and payment-method status.",
    href: "/admin/settings/payments",
    icon: KeyRound,
    available: true,
  },
  {
    title: "Email & SMS",
    description: "Resend / MSG91 keys and template IDs.",
    href: "/admin/settings/notifications",
    icon: Mail,
    available: true,
  },
  {
    title: "OTP delivery",
    description: "Toggle real SMS / SMTP sending; fall back to a fixed bypass code from the deploy env.",
    href: "/admin/settings/otp",
    icon: MessageSquare,
    available: true,
  },
  {
    title: "Audit log",
    description: "Immutable trail of every admin write.",
    href: "/admin/activity",
    icon: History,
    available: true,
  },
  {
    title: "Notification rules",
    description: "Map order/shipment events to email or SMS templates.",
    href: "/admin/settings/notifications-rules",
    icon: Bell,
    available: true,
  },
  {
    title: "Webhooks",
    description: "Outbound HTTP callbacks with HMAC signing and retry queue.",
    href: "/admin/settings/webhooks",
    icon: Webhook,
    available: true,
  },
  {
    title: "ERP sync",
    description: "One-click pull of every doctype from the legacy ERPNext via the Frappe REST API.",
    href: "/admin/settings/erp-sync",
    icon: RefreshCw,
    available: true,
  },
];

export default function SettingsIndex() {
  return (
    <div>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        Settings
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        System-level configuration. Most settings live in environment variables
        right now — surfacing them in the UI is on the roadmap.
      </p>

      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        {sections.map((s) => {
          const Cmp = s.available ? "a" : "div";
          return (
            <Cmp
              key={s.title}
              {...(s.available ? { href: s.href } : {})}
              className={
                "rounded-2xl border bg-white p-6 transition-all " +
                (s.available
                  ? "border-ink-100 hover:border-brand hover:shadow-[0_15px_30px_-15px_rgba(228,113,39,0.25)] cursor-pointer"
                  : "border-ink-100 opacity-60 cursor-not-allowed")
              }
            >
              <span
                className={
                  "grid h-10 w-10 place-items-center rounded-xl " +
                  (s.available
                    ? "bg-brand-50 text-brand"
                    : "bg-ink-100 text-ink-400")
                }
              >
                <s.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-[18px] font-bold text-ink-900">
                {s.title}
              </h3>
              <p className="mt-1.5 text-[13px] text-ink-600 leading-relaxed">
                {s.description}
              </p>
              {!s.available && (
                <span className="mt-3 inline-block text-[11px] font-bold tracking-wider uppercase text-ink-400">
                  Coming soon
                </span>
              )}
            </Cmp>
          );
        })}
      </div>
    </div>
  );
}
