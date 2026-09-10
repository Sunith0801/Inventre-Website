import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { getCurrentUser } from "@/server/session";
import {
  ADMIN_PAGES,
  ADMIN_PAGE_BY_SLUG,
  canSeePage,
  pageHref,
} from "@/lib/admin-permissions";

/**
 * Per-section authorization for /admin.
 *
 * WHY THIS EXISTS. The (protected) layout authenticates the session and
 * confirms the account holds at least one non-fees permission — then admitted
 * it to all 121 admin pages. Because 89 of those pages query the database
 * inside the page file, the data was rendered and sent before any API
 * permission check could run: a content editor could open the receivables
 * report simply by typing its URL. `canSeePage` was written for exactly this
 * gate (see its docblock) and was never wired up.
 *
 * WHY A LAYOUT AND NOT 121 PAGE EDITS. A permission is a property of a
 * SECTION, not of each page in it, and a route-group layout re-executes
 * whenever the browser enters its segment — including client-side
 * navigations. One six-line layout per section covers every page beneath it,
 * present and future, and there is no path-matching table to drift.
 *
 * WHY IT NEVER DEAD-ENDS. Denial renders inside the admin shell with the
 * sidebar intact and lists the sections this account CAN open. A 403 that
 * strands somebody on a blank page is indistinguishable from an outage, and
 * the roles here are narrow: Operations holds nine permissions, so denial is
 * a normal daily event rather than an exception.
 *
 * Passing requires read OR write on ANY of `slugs`, matching what the sidebar
 * already uses to decide whether to show the link — so nothing a user can see
 * becomes unreachable, and nothing unreachable stays visible.
 */
export async function SectionGate({
  slugs,
  children,
}: {
  slugs: readonly string[];
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();

  // Unauthenticated never reaches here — middleware gates /admin/* and the
  // (protected) layout redirects — so this is defence in depth, not the door.
  if (!me || me.kind !== "admin") return null;

  if (slugs.some((slug) => canSeePage(me.permissions, slug))) return <>{children}</>;

  const wanted = ADMIN_PAGE_BY_SLUG.get(slugs[0]);
  const available = ADMIN_PAGES.filter((p) => canSeePage(me.permissions, p.slug));

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="rounded-2xl border border-ink-200 bg-white p-8">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-700">
          <ShieldOff className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink-900">
          You don&apos;t have access to {wanted?.label ?? "this section"}
        </h1>
        <p className="mt-1.5 text-sm text-ink-600">
          Your role is <span className="font-medium text-ink-900">{me.roleName}</span>. Ask an
          administrator to grant it on Settings → Roles &amp; permissions if you need this section.
        </p>

        {available.length > 0 ? (
          <div className="mt-6 border-t border-ink-100 pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Sections you can open
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {available.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={pageHref(p.slug)}
                    className="inline-flex rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-800 hover:border-brand-300 hover:text-brand-700"
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-6 border-t border-ink-100 pt-5 text-sm text-ink-600">
            No sections are assigned to your role yet.
          </p>
        )}
      </div>
    </div>
  );
}
