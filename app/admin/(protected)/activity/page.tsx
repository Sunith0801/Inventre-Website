import { and, desc, eq, gte, ilike, isNotNull, lt, or, sql } from "drizzle-orm";
import * as React from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import {
  PageHeader,
  Stat,
  Badge,
  Toolbar,
  SearchInput,
  Input,
  DataTable,
  Th,
  Td,
  Tr,
  EmptyState,
  Pagination,
  type Tone,
  FilterSelect,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import type { FieldChange } from "@/server/activity";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Search = {
  q?: string;
  module?: string;
  actor?: string;
  since?: string;
  from?: string;
  to?: string;
  page?: string;
};

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const guard = await requireAnyPermission("activity.read", "activity.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const mod = sp.module || undefined;
  const actor = sp.actor || undefined;
  const since = sp.since || undefined;
  const fromStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : undefined;
  const toStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : undefined;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const sinceDate =
    since === "today"
      ? startOfToday
      : since === "7d"
        ? sevenDaysAgo
        : since === "30d"
          ? new Date(Date.now() - 30 * 86400_000)
          : null;

  const conds = [
    q
      ? or(
          ilike(activityLog.summary, `%${q}%`),
          ilike(activityLog.actorEmail, `%${q}%`),
          ilike(activityLog.actorName, `%${q}%`),
          ilike(activityLog.action, `%${q}%`),
          ilike(activityLog.entityId, `%${q}%`)
        )
      : undefined,
    mod ? eq(activityLog.entityType, mod) : undefined,
    actor ? eq(activityLog.actorEmail, actor) : undefined,
    sinceDate ? gte(activityLog.createdAt, sinceDate) : undefined,
    fromStr ? gte(activityLog.createdAt, new Date(`${fromStr}T00:00:00`)) : undefined,
    toStr ? lt(activityLog.createdAt, new Date(new Date(`${toStr}T00:00:00`).getTime() + 86400_000)) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];
  const where = conds.length ? and(...conds) : undefined;

  const [rows, total, todayCount, weekCount, weekActors, modules, actors] =
    await Promise.all([
      db
        .select()
        .from(activityLog)
        .where(where)
        .orderBy(desc(activityLog.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.$count(activityLog, where),
      db.$count(activityLog, gte(activityLog.createdAt, startOfToday)),
      db.$count(activityLog, gte(activityLog.createdAt, sevenDaysAgo)),
      db
        .select({ n: sql<number>`count(distinct coalesce(${activityLog.actorEmail}, ${activityLog.actorId}::text))` })
        .from(activityLog)
        .where(gte(activityLog.createdAt, sevenDaysAgo))
        .then((r) => Number(r[0]?.n ?? 0)),
      db
        .selectDistinct({ v: activityLog.entityType })
        .from(activityLog)
        .orderBy(activityLog.entityType),
      db
        .selectDistinct({ v: activityLog.actorEmail })
        .from(activityLog)
        .where(isNotNull(activityLog.actorEmail))
        .orderBy(activityLog.actorEmail),
    ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const filtered = Boolean(q || mod || actor || since || fromStr || toStr);

  function hrefFor(p: number) {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (mod) u.set("module", mod);
    if (actor) u.set("actor", actor);
    if (since) u.set("since", since);
    if (fromStr) u.set("from", fromStr);
    if (toStr) u.set("to", toStr);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/admin/activity${s ? `?${s}` : ""}`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Activity Log"
        description="Every change made in the admin — who did it, to which record, and what changed."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Today" value={todayCount.toLocaleString("en-IN")} />
        <Stat label="Last 7 days" value={weekCount.toLocaleString("en-IN")} />
        <Stat label="Active users" value={weekActors.toLocaleString("en-IN")} hint="Last 7 days" />
        <Stat label={filtered ? "Matching" : "All time"} value={total.toLocaleString("en-IN")} />
      </div>

      <AutoSubmitForm action="/admin/activity" debounceMs={400}>
        <Toolbar>
          <SearchInput defaultValue={q} placeholder="Search by user, record, or description…" />
          <FilterSelect label="Module" name="module" defaultValue={mod ?? ""}>
            {modules.map((m) => (
              <option key={m.v} value={m.v}>
                {moduleLabel(m.v)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="User" name="actor" defaultValue={actor ?? ""}>
            {actors.map((a) => (
              <option key={a.v!} value={a.v!}>
                {a.v}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Period" allLabel="All time" name="since" defaultValue={since ?? ""}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </FilterSelect>
          <Input type="date" name="from" defaultValue={fromStr ?? ""} aria-label="From date" className="w-auto" />
          <span className="text-[12px] text-ink-400">to</span>
          <Input type="date" name="to" defaultValue={toStr ?? ""} aria-label="To date" className="w-auto" />
          {filtered ? (
            <Link
              href="/admin/activity"
              className="inline-flex h-9 items-center rounded-lg px-3 text-[12.5px] font-semibold text-ink-600 hover:bg-cream-100 hover:text-ink-900"
            >
              Clear
            </Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      <DataTable
        empty={
          rows.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={filtered ? "No activity matches these filters" : "No activity yet"}
              description={
                filtered
                  ? "Try a wider period or clear the filters."
                  : "Every admin write — a product update, an order confirmation, a refund — will appear here."
              }
            />
          ) : undefined
        }
      >
        <table className="w-full min-w-[900px]">
          <thead className="bg-cream-50/60">
            <tr>
              <Th>Time</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>Record</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const day = fmtDay(r.createdAt);
              const prevDay = i > 0 ? fmtDay(rows[i - 1]!.createdAt) : null;
              const changes = Array.isArray(r.changes) ? (r.changes as FieldChange[]) : [];
              const href = recordHref(r.entityType, r.entityId);
              const who = r.actorName ?? r.actorEmail ?? "System";
              return (
                <React.Fragment key={r.id}>
                  {day !== prevDay ? (
                    <tr className="border-t border-ink-100/70 bg-cream-50/40">
                      <td colSpan={5} className="px-4 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                        {day}
                      </td>
                    </tr>
                  ) : null}
                  <Tr className="align-top">
                    <Td className="whitespace-nowrap py-2 text-[12.5px] tabular-nums text-ink-600">
                      {fmtTime(r.createdAt)}
                    </Td>
                    <Td className="py-2 whitespace-nowrap">
                      <span className="text-[13px] font-medium text-ink-900" title={[r.actorEmail, r.ip ? `IP ${r.ip}` : null].filter(Boolean).join(" · ") || undefined}>
                        {who}
                      </span>
                      {r.actorRole ? (
                        <span className="ml-1.5 rounded bg-ink-100 px-1 py-px align-middle text-[9.5px] font-semibold uppercase tracking-wider text-ink-600">
                          {roleLabel(r.actorRole)}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="py-2 whitespace-nowrap">
                      <Badge tone={actionTone(r.action)} size="sm" dot className="whitespace-nowrap">
                        {actionLabel(r.action)}
                      </Badge>
                    </Td>
                    <Td className="py-2 whitespace-nowrap">
                      <span className="text-[12.5px] text-ink-700">{moduleLabel(r.entityType)}</span>
                      {r.entityId ? (
                        <>
                          <span className="mx-1 text-ink-300">·</span>
                          {href ? (
                            <Link href={href} className="font-mono text-[11px] text-brand-700 hover:underline" title={r.entityId}>
                              {shortId(r.entityId)}
                            </Link>
                          ) : (
                            <span className="font-mono text-[11px] text-ink-400" title={r.entityId}>
                              {shortId(r.entityId)}
                            </span>
                          )}
                        </>
                      ) : null}
                    </Td>
                    <Td className="py-2">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                      <span className="text-[13px] text-ink-800 leading-snug">{r.summary ?? "—"}</span>
                      {changes.length > 0 ? (
                        <span className="inline-flex flex-wrap gap-x-4 gap-y-0.5">
                          {changes.slice(0, 4).map((c, j) => (
                            <span key={j} className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap">
                              <span className="text-ink-500">{c.label || c.field}</span>
                              <span className="text-rose-600 line-through decoration-rose-300">{fmtValue(c.old)}</span>
                              <span className="text-ink-300">→</span>
                              <span className="font-medium text-emerald-700">{fmtValue(c.new)}</span>
                            </span>
                          ))}
                          {changes.length > 4 ? (
                            <span className="text-[11.5px] text-ink-400">+{changes.length - 4} more</span>
                          ) : null}
                        </span>
                      ) : null}
                      </div>
                      {r.remarks ? (
                        <div className="mt-0.5 text-[12px] text-ink-500">{r.remarks}</div>
                      ) : null}
                    </Td>
                  </Tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </DataTable>

      {total > 0 ? (
        <Pagination
          page={page}
          pages={pages}
          from={from}
          to={to}
          total={total}
          hrefFor={hrefFor}
          noun="event"
          className="mt-4"
        />
      ) : null}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  student: "Student",
  parent: "Customer",
  user: "Admin user",
  admin_role: "Role",
  coupon: "Discount",
  product: "Product",
  order: "Order",
  support: "Support access",
  school: "School",
  grade: "Grade",
  bundle: "Bundle",
  bom: "BOM",
};

function moduleLabel(t: string): string {
  return MODULE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function recordHref(type: string, id: string | null): string | null {
  if (!id) return null;
  switch (type) {
    case "student": return `/admin/students/${id}`;
    case "parent": return `/admin/customers/${id}`;
    case "user": return `/admin/settings/users/${id}`;
    case "coupon": return `/admin/discounts/${id}`;
    case "product": return `/admin/products/${id}`;
    case "order": return `/admin/orders/${id}`;
    default: return null;
  }
}

/** "student.guardian.add" → "Guardian added"; "product.update" → "Updated". */
function actionLabel(action: string): string {
  const parts = action.split(".").slice(1);
  if (parts.length === 0) return action;
  const verb = parts[parts.length - 1]!;
  const object = parts.slice(0, -1).join(" ").replace(/_/g, " ");
  const past = VERB_PAST[verb] ?? verb.replace(/_/g, " ");
  const text = object ? `${object} ${past}` : past;
  return text
    .replace(/^\w/, (m) => m.toUpperCase())
    .replace(/\bmcb\b/i, "MCB")
    .replace(/\bcca\b/i, "CCAvenue");
}

const VERB_PAST: Record<string, string> = {
  create: "created",
  add: "added",
  update: "updated",
  delete: "deleted",
  remove: "removed",
  set: "set",
  grant: "granted",
  revoke: "revoked",
  import: "imported",
  mint: "issued",
  exit: "ended",
  cancel: "cancelled",
  confirm: "confirmed",
  refund: "refunded",
  refresh_cca: "payment refreshed",
  bulk_set_new: "bulk-marked new",
  unlinked: "unlinked",
  permissions: "permissions changed",
};

function actionTone(action: string): Tone {
  const verb = action.split(".").pop() ?? "";
  if (/^(create|add|grant|import|mint|confirm)$/.test(verb)) return "success";
  if (/^(delete|remove|revoke|cancel|unlinked|exit)$/.test(verb)) return "danger";
  if (/^(refund|refresh_cca)$/.test(verb)) return "warning";
  if (/^(update|set|permissions|bulk_set_new)$/.test(verb)) return "info";
  return "default";
}

function roleLabel(role: string): string {
  switch (role) {
    case "super": return "Super Admin";
    case "admin": return "Admin";
    case "ops": return "Customer Care";
    case "school_admin": return "School Admin";
    default: return role.replace(/_/g, " ");
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function fmtDay(d: Date): string {
  return new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}
