import { Card, CardHeader } from "@/components/admin/ui/primitives";

/**
 * A report table block: white card, title row (optional description and
 * right-hand actions), then the table or empty state flush to the edges.
 * Every report page uses this so the tables line up from one report to
 * the next.
 */
export function ReportTable({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card padded={false} className={className}>
      {title ? (
        <div className="px-5 pt-5 pb-3 lg:px-6 lg:pt-6">
          <CardHeader title={title} description={description} actions={actions} className="mb-0" />
        </div>
      ) : null}
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

/** Header action: a download link styled like the secondary button. */
export function DownloadLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-900 transition-colors hover:border-ink-300 hover:bg-cream-100"
    >
      {children}
    </a>
  );
}
