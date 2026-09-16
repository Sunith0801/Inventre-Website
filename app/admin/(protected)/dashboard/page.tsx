import {
  School,
  Users,
  Package,
  ShoppingBag,
  IndianRupee,
  Star,
  Inbox,
  TrendingUp,
  ArrowRight,
  ChevronRight,
  BarChart3,
  Truck,
  Wallet,
  Activity,
  Webhook,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { getAdminStats } from "@/server/repos/admin-stats";
import { getSystemStatus } from "@/server/admin/system-status";
import { UniversalSearch } from "@/components/admin/UniversalSearch";
import { StatusStrip, type StatusItem } from "@/components/admin/StatusStrip";
import { getCurrentUser } from "@/server/session";
import {
  PageHeader,
  Stat,
  Card,
  CardHeader,
  Badge,
  EmptyState,
  Money,
  Toolbar,
  statusTone,
  Th,
  Td,
  Tr,
  type Tone,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { PeriodRangeFields } from "@/components/admin/PeriodRangeFields";
import { ReportTable } from "@/components/admin/reports/ReportTable";
import { validDate } from "@/components/admin/reports/ReportToolbar";
import { redirect } from "next/navigation";
import { canSeePage, firstAccessiblePath } from "@/lib/admin-permissions";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
] as const;

/** "Good morning" by the IST clock, never the server's. */
function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

type Attention = { href: string; label: string; count: number; icon: LucideIcon; tone: Tone };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ dateRange?: string; from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") redirect("/admin/login");
  // Restricted roles (ops / custom / school_admin) may not hold the
  // dashboard permission. Send them to the first page they CAN see rather
  // than back to /admin/dashboard, which would loop forever.
  if (!canSeePage(me.permissions, "dashboard")) {
    const landing = firstAccessiblePath(me.permissions);
    if (landing) redirect(landing);
    // Admin with no visible pages at all — show a message, never loop.
    return (
      <div>
        <PageHeader
          eyebrow="Admin"
          title="No pages available"
          description="Your account doesn't have access to any admin pages yet. Ask a super-admin to grant permissions on your role."
        />
      </div>
    );
  }
  const can = (slug: string) => canSeePage(me.permissions, slug);

  const sp = await searchParams;
  const preset = PRESETS.find((p) => p.value === sp.dateRange)?.value ?? null;
  // A preset and explicit dates are exclusive (PeriodRangeFields clears one
  // when the other is picked); a hand-edited URL carrying both follows the
  // preset. Malformed dates are dropped — they are cast to `date` in SQL.
  const from = preset ? "" : validDate(sp.from);
  const to = preset ? "" : validDate(sp.to);

  // The system probes are only shown to admins who can act on them; skip
  // the round-trips entirely for everyone else.
  const showsSystem = can("settings-erp-bridge") || can("settings-otp");
  const [s, sys] = await Promise.all([
    getAdminStats({ preset, from: from || null, to: to || null }),
    showsSystem ? getSystemStatus() : Promise.resolve(null),
  ]);

  // Tile labels rephrase when a range is active so "today" doesn't
  // mislead the user when they've selected, say, "This month".
  const hasRange = Boolean(preset || from || to);
  const rangeLabel =
    preset === "today" ? "today" :
    preset === "week"  ? "this week" :
    preset === "month" ? "this month" :
    hasRange           ? "in range" :
    "today";
  const paidHint = (() => {
    const b = s.paidBreakdownToday;
    const parts: string[] = [];
    if (b.ccavenue) parts.push(`${b.ccavenue} CCAvenue`);
    if (b.zeroValue) parts.push(`${b.zeroValue} zero-value`);
    return parts.length ? parts.join(" · ") : "Successful checkouts";
  })();

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-IN", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
  }).format(now);
  const firstName = (me.name ?? me.email).split(/[\s@]/)[0] ?? "";

  // Things that want a human. Only counted where the admin can open the
  // page; the list is empty for most restricted roles and says so quietly.
  const attention: Attention[] = [];
  if (can("reviews") && s.pendingReviews)
    attention.push({ href: "/admin/reviews?status=pending", label: "Reviews awaiting moderation", count: s.pendingReviews, icon: Star, tone: "warning" });
  if (can("contact-forms") && s.newInquiries)
    attention.push({ href: "/admin/contact-forms?status=new", label: "Inquiries nobody has picked up", count: s.newInquiries, icon: Inbox, tone: "warning" });
  if (sys && can("settings-erp-bridge")) {
    const failed = sys.erp.failed + sys.erp.dlq;
    if (failed) attention.push({ href: "/admin/settings/erp-bridge", label: "ERP events failed to deliver", count: failed, icon: Activity, tone: "danger" });
    if (sys.webhooks.failing) attention.push({ href: "/admin/settings/webhooks", label: "Webhook endpoints returning errors", count: sys.webhooks.failing, icon: Webhook, tone: "danger" });
  }

  const strip: StatusItem[] = [];
  if (sys) {
    strip.push({ label: "Database", probe: sys.db }, { label: "Cache", probe: sys.redis });
    if (can("settings-erp-bridge"))
      strip.push({
        label: "ERP bridge", probe: sys.erp.probe, href: "/admin/settings/erp-bridge",
        detail: !sys.erp.bridge ? "off" : sys.erp.failed + sys.erp.dlq ? `${sys.erp.failed + sys.erp.dlq} failed` : sys.erp.pending ? `${sys.erp.pending} queued` : "idle",
      });
    if (can("settings-otp"))
      strip.push(
        { label: "SMS", probe: sys.sms.probe, href: "/admin/settings/otp", detail: !sys.sms.configured ? "off" : sys.sms.realSend ? "sending" : "muted" },
        { label: "Email", probe: sys.email.probe, href: "/admin/settings/otp", detail: !sys.email.configured ? "off" : sys.email.realSend ? "sending" : "muted" },
      );
  }

  const glance: { href: string; label: string; value: number; icon: LucideIcon }[] = [
    { href: "/admin/schools", label: "Schools", value: s.totalSchools, icon: School },
    { href: "/admin/products", label: "Products", value: s.totalProducts, icon: Package },
    { href: "/admin/customers", label: "Parents", value: s.totalParents, icon: Users },
  ];
  const reports = [
    { href: "/admin/reports/sales", label: "Sales", icon: BarChart3 },
    { href: "/admin/reports/fulfillment", label: "Fulfillment", icon: Truck },
    { href: "/admin/reports/items", label: "Item-wise sales", icon: Package },
    { href: "/admin/reports/receivables", label: "Receivables", icon: Wallet },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        title="Dashboard"
        description={
          <>
            {`${greeting(now)}${firstName ? `, ${firstName}` : ""}. It's ${today} — here's where the store stands.`}
          </>
        }
      />
      <UniversalSearch permissions={[...me.permissions]} />
      {strip.length ? <StatusStrip items={strip} /> : null}

      {/* Every revenue / orders KPI and the Recent orders table re-query
          against the selected window. Keyed by the settled range so the
          uncontrolled pills re-render with it after navigation. */}
      <AutoSubmitForm key={`${preset ?? ""}|${from}|${to}`} action="/admin/dashboard">
        <Toolbar>
          <PeriodRangeFields preset={preset ?? ""} from={from} to={to} presets={[...PRESETS]} />
        </Toolbar>
      </AutoSubmitForm>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Revenue ${rangeLabel}`} value={<Money paise={s.gmvToday * 100} />} icon={IndianRupee} iconTone="success" hint="Paid orders" />
        <Stat label={`Paid orders ${rangeLabel}`} value={s.paidOrdersToday.toLocaleString("en-IN")} icon={TrendingUp} iconTone="brand" hint={paidHint} />
        <Stat label={hasRange ? "Orders in range" : "Orders all-time"} value={s.totalOrders.toLocaleString("en-IN")} icon={ShoppingBag} iconTone="info" hint="Including unpaid" />
        <Stat label="Parents" value={s.totalParents.toLocaleString("en-IN")} icon={Users} iconTone="violet" hint="Registered accounts" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ReportTable
            title="Recent orders"
            description={hasRange ? "Latest 10 in the selected range" : "Latest 10 placed"}
            actions={
              <Link href="/admin/orders" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            {s.recentOrders.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title={hasRange ? "No orders in this range" : "No orders yet"}
                description={hasRange ? "Pick a different period or dates." : "Orders appear here as customers complete checkout."}
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Payment</Th>
                    <Th right>Total</Th>
                    <Th right>Placed</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.recentOrders.map((o) => {
                    // Mirror /admin/orders exactly: same label, same tone.
                    const label =
                      o.statusBucket === "confirmed" ? "Confirmed" :
                      o.statusBucket === "pending"   ? "Pending" :
                      o.statusBucket === "aborted"   ? "Aborted by Customer" :
                      o.statusBucket === "failed"    ? "Failed" :
                      o.statusBucket === "refunded"  ? "Refunded" :
                      o.status;
                    const tone: Tone =
                      o.statusBucket === "confirmed" ? "success" :
                      o.statusBucket === "pending"   ? "warning" :
                      o.statusBucket === "aborted"   ? "danger"  :
                      o.statusBucket === "failed"    ? "danger"  :
                      o.statusBucket === "refunded"  ? "violet"  :
                      statusTone(label);
                    return (
                      <Tr key={o.id}>
                        <Td>
                          <Link href={`/admin/orders/${o.id}`} className="whitespace-nowrap font-mono text-[12px] hover:text-brand-700">
                            {o.orderNumber}
                          </Link>
                        </Td>
                        <Td><Badge tone={tone} dot size="sm" className="whitespace-nowrap">{label}</Badge></Td>
                        <Td right><Money paise={o.total * 100} className="font-semibold" /></Td>
                        <Td right muted className="whitespace-nowrap">
                          {new Date(o.createdAt).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ReportTable>

          <Card padded={false}>
            <div className="px-5 pt-5 pb-2">
              <CardHeader
                title="Reports"
                description="The numbers behind the tiles above."
                className="mb-0"
                actions={
                  <Link href="/admin/reports" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                    All reports <ArrowRight className="h-3 w-3" />
                  </Link>
                }
              />
            </div>
            <ul className="grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-4">
              {reports.map((r) => (
                <li key={r.href} className="min-w-0">
                  <Link href={r.href} className="flex items-center gap-2 rounded-lg border border-ink-100/70 px-3 py-2 text-[13px] font-medium text-ink-800 transition-colors hover:border-ink-200 hover:bg-cream-50">
                    <r.icon className="h-4 w-4 shrink-0 text-brand-700" />
                    <span className="truncate">{r.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card padded={false}>
            <div className="px-5 pt-5 pb-2">
              <CardHeader
                title="Needs attention"
                description={attention.length ? "Things waiting on a person." : undefined}
                className="mb-0"
              />
            </div>
            {attention.length === 0 ? (
              <div className="flex items-center gap-3 px-5 pb-5 pt-1 text-[13px] text-ink-600">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                Nothing is waiting on you right now.
              </div>
            ) : (
              <ul className="divide-y divide-ink-100/70">
                {attention.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-cream-50">
                      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", a.tone === "danger" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")}>
                        <a.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-ink-800">{a.label}</span>
                      <span className={cn("text-[14px] font-semibold tabular-nums", a.tone === "danger" ? "text-red-700" : "text-amber-800")}>
                        {a.count.toLocaleString("en-IN")}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-ink-300 transition-colors group-hover:text-ink-600" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5 pb-2">
              <CardHeader title="At a glance" className="mb-0" />
            </div>
            <ul className="divide-y divide-ink-100/70">
              {glance.map((g) => (
                <li key={g.href}>
                  <Link href={g.href} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-cream-50">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cream-100 text-ink-600">
                      <g.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] font-medium text-ink-800">{g.label}</span>
                    <span className="text-[14px] font-semibold tabular-nums text-ink-900">{g.value.toLocaleString("en-IN")}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-ink-300 transition-colors group-hover:text-ink-600" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
