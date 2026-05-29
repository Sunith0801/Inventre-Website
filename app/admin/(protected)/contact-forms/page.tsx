import { desc, and, eq, ilike, gte, or } from "drizzle-orm";
import { Inbox } from "lucide-react";
import { db } from "@/db/client";
import { contactSubmissions } from "@/db/schema";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  EmptyState,
  Badge,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Kind = "parent" | "school" | "business";

type ContactPayload = {
  organization?: string | null;
  interest?: string | null;
  board?: string | null;
  businessType?: string | null;
  address?: string | null;
  gst?: string | null;
  message?: string | null;
} | null;

function kindBadge(kind: string) {
  if (kind === "parent") return <Badge tone="info" size="sm">parent</Badge>;
  if (kind === "school") return <Badge tone="success" size="sm">school</Badge>;
  if (kind === "business") return <Badge tone="warning" size="sm">business</Badge>;
  return <Badge tone="neutral" size="sm">{kind}</Badge>;
}

function statusBadge(status: string) {
  if (status === "new") return <Badge tone="warning" size="sm">new</Badge>;
  if (status === "in_progress")
    return <Badge tone="info" size="sm">in progress</Badge>;
  if (status === "done") return <Badge tone="success" size="sm">done</Badge>;
  return <Badge tone="neutral" size="sm">{status}</Badge>;
}

export default async function ContactFormsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    kind?: Kind | "";
    status?: string;
    since?: string;
    page?: string;
  }>;
}) {
  const { q, kind, status, since, page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const sinceDate =
    since === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : since === "7d"
        ? new Date(Date.now() - 7 * 86400_000)
        : since === "30d"
          ? new Date(Date.now() - 30 * 86400_000)
          : null;

  const term = (q ?? "").trim();
  const like = `%${term}%`;
  const conds = [
    term
      ? or(
          ilike(contactSubmissions.name, like),
          ilike(contactSubmissions.email, like),
          ilike(contactSubmissions.phone, like),
        )
      : undefined,
    kind ? eq(contactSubmissions.kind, kind) : undefined,
    status ? eq(contactSubmissions.status, status) : undefined,
    sinceDate ? gte(contactSubmissions.createdAt, sinceDate) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  // db.$count returns Promise<number> directly. The select({ total: $count })
  // .from(table) pattern used elsewhere in admin happens to work only because
  // the target table is never empty in practice — when there are zero rows
  // the destructure `[{ total }] = []` throws (which is how this page
  // initially crashed before any submissions had been collected).
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(contactSubmissions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contactSubmissions.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.$count(
      contactSubmissions,
      conds.length ? and(...conds) : undefined,
    ),
  ]);

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));

  function qs(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = {
      q: term || undefined,
      kind,
      status,
      since,
      page: String(page),
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    return `?${p}`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Engagement"
        title="Contact forms"
        description={`${Number(total).toLocaleString()} submissions · from /contact (Parent · School · Business tabs)`}
      />

      <form method="GET" className="mb-4 flex flex-wrap gap-3">
        <input
          name="q"
          defaultValue={term}
          placeholder="Search name, email, phone…"
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-brand/20 min-w-[240px]"
        />
        <select
          name="kind"
          defaultValue={kind ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All types</option>
          <option value="parent">Parent</option>
          <option value="school">School</option>
          <option value="business">Business</option>
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <select
          name="since"
          defaultValue={since ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <input type="hidden" name="page" value="1" />
        <button
          type="submit"
          className="h-9 rounded-lg bg-ink-900 px-4 text-[13px] font-semibold text-white hover:bg-ink-700"
        >
          Filter
        </button>
        <a
          href="/admin/contact-forms"
          className="h-9 inline-flex items-center rounded-lg border border-ink-200 px-4 text-[13px] font-semibold text-ink-600 hover:bg-ink-50"
        >
          Clear
        </a>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No contact-form submissions"
            description="Submissions from /contact will appear here."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Type</Th>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>Organization</Th>
                <Th>Message</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = (r.payload ?? null) as ContactPayload;
                // School / business get an "Organization" cell that
                // composites several fields so the admin doesn't have to
                // click through for the common context (board / type /
                // GST). Parent rows just show "—" here.
                const orgBits: string[] = [];
                if (p?.organization) orgBits.push(p.organization);
                if (p?.board) orgBits.push(p.board);
                if (p?.businessType) orgBits.push(p.businessType);
                if (p?.interest) orgBits.push(`int: ${p.interest}`);
                if (p?.gst) orgBits.push(`GST: ${p.gst}`);
                return (
                  <Tr key={r.id}>
                    <Td muted>
                      <span className="text-[12px] tabular-nums whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </Td>
                    <Td>{kindBadge(r.kind)}</Td>
                    <Td>
                      <span className="font-semibold text-[13px] text-ink-900">
                        {r.name}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <a
                          href={`mailto:${r.email}`}
                          className="text-[12px] text-ink-900 hover:text-brand truncate max-w-[220px]"
                        >
                          {r.email}
                        </a>
                        <a
                          href={`tel:+91${r.phone}`}
                          className="font-mono text-[11px] text-ink-500 hover:text-ink-900"
                        >
                          +91 {r.phone}
                        </a>
                      </div>
                    </Td>
                    <Td>
                      {orgBits.length > 0 ? (
                        <div className="flex flex-col gap-0.5 max-w-[200px]">
                          {orgBits.map((bit, i) => (
                            <span
                              key={i}
                              className="text-[12px] text-ink-700 truncate"
                            >
                              {bit}
                            </span>
                          ))}
                          {p?.address ? (
                            <span className="text-[11px] text-ink-500 truncate">
                              {p.address}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                    <Td>
                      {p?.message ? (
                        <p
                          className="text-[12px] text-ink-700 whitespace-pre-wrap max-w-[320px] line-clamp-4"
                          title={p.message}
                        >
                          {p.message}
                        </p>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                    <Td>{statusBadge(r.status)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-[13px]">
          {page > 1 && (
            <a
              href={qs({ page: String(page - 1) })}
              className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50"
            >
              ← Prev
            </a>
          )}
          <span className="text-ink-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={qs({ page: String(page + 1) })}
              className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50"
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
