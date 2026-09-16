import Link from "next/link";
import { desc, and, eq, ilike, gte, or, sql, type SQL } from "drizzle-orm";
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
  FilterSelect,
  Toolbar,
  SearchInput,
  Stat,
} from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const BASE = "/admin/contact-forms";

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

const KIND_TONE: Record<string, "info" | "success" | "warning" | "default"> = { parent: "info", school: "success", business: "warning" };
const STATUS_LABEL: Record<string, string> = { new: "New", in_progress: "In progress", done: "Done" };
const STATUS_TONE: Record<string, "warning" | "info" | "success" | "default"> = { new: "warning", in_progress: "info", done: "success" };

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const IST_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

/**
 * Inquiries — every submission of the storefront's contact form (parents,
 * schools and businesses). Read-only: the form has no reply flow; the
 * team follows up by phone or email from here.
 */
export default async function ContactFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; status?: string; since?: string; page?: string; perPage?: string }>;
}) {
  const guard = await requireAnyPermission("contact-forms.read", "contact-forms.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const kind = (["parent", "school", "business"] as const).includes(sp.kind as Kind) ? (sp.kind as Kind) : "";
  const status = sp.status && sp.status in STATUS_LABEL ? sp.status : "";
  const since = sp.since === "today" || sp.since === "7d" || sp.since === "30d" ? sp.since : "";
  const paging = readPaging(sp);

  const sinceDate =
    since === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : since === "7d"
        ? new Date(Date.now() - 7 * 86400_000)
        : since === "30d"
          ? new Date(Date.now() - 30 * 86400_000)
          : null;

  const like = `%${term}%`;
  const conds: SQL[] = [];
  if (term) conds.push(or(ilike(contactSubmissions.name, like), ilike(contactSubmissions.email, like), ilike(contactSubmissions.phone, like))!);
  if (kind) conds.push(eq(contactSubmissions.kind, kind));
  if (status) conds.push(eq(contactSubmissions.status, status));
  if (sinceDate) conds.push(gte(contactSubmissions.createdAt, sinceDate));
  const where = conds.length ? and(...conds) : undefined;

  // db.$count returns Promise<number> directly, so an empty table is a 0,
  // not a throw from destructuring an empty result.
  const [rows, total, byStatus] = await Promise.all([
    db.select().from(contactSubmissions).where(where).orderBy(desc(contactSubmissions.createdAt)).limit(paging.perPage).offset(paging.offset),
    db.$count(contactSubmissions, where),
    db
      .select({ status: contactSubmissions.status, n: sql<number>`count(*)::int` })
      .from(contactSubmissions)
      .groupBy(contactSubmissions.status),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
  const allCount = byStatus.reduce((s, r) => s + Number(r.n), 0);

  const hrefWith = (over: Record<string, string> = {}) => {
    const u = new URLSearchParams();
    const base: Record<string, string> = { q: term, kind, status, since, ...over };
    for (const [k, v] of Object.entries(base)) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };
  const { pages, from, to } = pageMeta(total, paging);
  if (paging.page > pages) redirect(withPaging(hrefWith(), pages, paging.perPage));

  const hasFilter = !!(term || kind || status || since);
  const ring = (key: string) => (key === status ? "ring-2 ring-brand/40" : "");

  return (
    <div>
      <PageHeader
        eyebrow="Engagement & Content"
        title="Inquiries"
        description="Messages sent through the website's contact form."
      />

      {/* Status counts are filters; the ring marks the one in force. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={hrefWith({ status: "" })} className={`block rounded-2xl ${!status ? "ring-2 ring-brand/40" : ""}`}>
          <Stat label="All inquiries" value={allCount.toLocaleString("en-IN")} />
        </Link>
        {(["new", "in_progress", "done"] as const).map((s) => (
          <Link key={s} href={hrefWith({ status: s })} className={`block rounded-2xl ${ring(s)}`}>
            <Stat label={STATUS_LABEL[s]} value={(counts[s] ?? 0).toLocaleString("en-IN")} />
          </Link>
        ))}
      </div>

      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={term} placeholder="Search name, email or phone…" />
          <FilterSelect label="From" name="kind" defaultValue={kind}>
            <option value="parent">Parent</option>
            <option value="school">School</option>
            <option value="business">Business</option>
          </FilterSelect>
          <FilterSelect label="Status" name="status" defaultValue={status}>
            <option value="new">New</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </FilterSelect>
          <FilterSelect label="Received" allLabel="Any time" name="since" defaultValue={since}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </FilterSelect>
          {paging.perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="perPage" value={paging.perPage} /> : null}
          {hasFilter ? (
            <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={hasFilter ? "No inquiries match" : "No inquiries yet"}
            description={hasFilter ? "Try a different search or clear the filters." : "Submissions from the website's contact page appear here."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>From</Th>
                  <Th>Contact</Th>
                  <Th>Organisation</Th>
                  <Th>Message</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = (r.payload ?? null) as ContactPayload;
                  // School / business rows composite the useful context
                  // (board, type, interest, GST) so the admin need not click
                  // through. Parent rows just show "—".
                  const orgBits = [p?.organization, p?.board, p?.businessType, p?.interest ? `Interest: ${p.interest}` : null, p?.gst ? `GST ${p.gst}` : null].filter(Boolean) as string[];
                  const when = new Date(r.createdAt);
                  return (
                    <Tr key={r.id}>
                      <Td muted className="whitespace-nowrap">
                        {IST.format(when)}
                        <span className="block text-[11.5px]">{IST_TIME.format(when)}</span>
                      </Td>
                      <Td><Badge tone={KIND_TONE[r.kind] ?? "default"} size="sm" className="capitalize">{r.kind}</Badge></Td>
                      <Td>
                        <span className="block font-semibold text-ink-900">{r.name}</span>
                        <a href={`mailto:${r.email}`} className="block max-w-[220px] truncate text-[12px] font-normal text-ink-600 hover:text-brand-700">{r.email}</a>
                        <a href={`tel:+91${r.phone}`} className="block font-mono text-[12px] font-normal text-ink-500 hover:text-ink-900">{r.phone}</a>
                      </Td>
                      <Td muted>
                        {orgBits.length > 0 ? (
                          <div className="max-w-[220px]">
                            <span className="block truncate text-ink-800">{orgBits[0]}</span>
                            {orgBits.length > 1 ? <span className="block truncate text-[12px]">{orgBits.slice(1).join(" · ")}</span> : null}
                            {p?.address ? <span className="block truncate text-[12px]">{p.address}</span> : null}
                          </div>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </Td>
                      <Td muted>
                        {p?.message ? (
                          <p className="line-clamp-3 max-w-[360px] whitespace-pre-wrap text-ink-700" title={p.message}>{p.message}</p>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </Td>
                      <Td><Badge tone={STATUS_TONE[r.status] ?? "default"} dot size="sm">{STATUS_LABEL[r.status] ?? r.status}</Badge></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination page={paging.page} pages={pages} from={from} to={to} total={total} noun="inquiry" hrefFor={(p) => withPaging(hrefWith(), p, paging.perPage)}>
            <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => withPaging(hrefWith(), 1, pp)} />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
