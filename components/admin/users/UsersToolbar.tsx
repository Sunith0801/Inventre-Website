/**
 * Filter bar for the Users screen.
 *
 * Server-renderable. All filter state lives in the URL, which means a filtered
 * view is shareable, survives a refresh, works with the back button, and
 * needs no client state to keep in sync with the table below it.
 *
 * ── The hidden inputs are load-bearing ──────────────────────────────────
 * `AutoSubmitForm` rebuilds the query string from the form's OWN fields on
 * every change. Sort, direction and page size are not visible controls, so
 * without these three hidden inputs, changing any filter would silently reset
 * the operator's sort order and page size back to the defaults. This is the
 * single most common bug in URL-driven filter bars.
 */

import * as React from "react";
import Link from "next/link";
import { Download, X } from "lucide-react";
import {
  SearchInput,
  Toolbar,
  Button,
  FilterSelect,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import {
  LAST_LOGIN_LABELS,
  USER_STATUSES,
  USER_STATUS_LABEL,
  hasActiveFilters,
  usersHref,
  type UserFilters,
} from "@/lib/admin-users-view";
import type { FilterOption } from "@/server/repos/admin-users";

export function UsersToolbar({
  filters,
  roles,
  scopes,
  exportHref,
}: {
  filters: UserFilters;
  roles: FilterOption[];
  scopes: FilterOption[];
  exportHref: string;
}) {
  const active = hasActiveFilters(filters);

  return (
    <div className="mb-3">
      <AutoSubmitForm action="/admin/settings/users" debounceMs={350}>
        <Toolbar>
          <SearchInput
            name="q"
            defaultValue={filters.q}
            placeholder="Search name or email…"
          />

          <FilterSelect label="Role" name="role" defaultValue={filters.roleId ?? ""}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.count})
              </option>
            ))}
          </FilterSelect>

          {/*
            "Scope" is this system's Location/Department axis. An account is
            either scoped to one school or unscoped (sees everything), so the
            filter offers that distinction rather than a generic place name.
            Rendered only when at least one account is actually scoped —
            an always-empty dropdown is noise on every other install.
          */}
          {scopes.length > 0 ? (
            <FilterSelect label="Scope" name="school" defaultValue={filters.schoolId ?? ""}>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.count})
                </option>
              ))}
            </FilterSelect>
          ) : null}

          <FilterSelect label="Status" name="status" defaultValue={filters.status ?? ""}>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {USER_STATUS_LABEL[s]}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect label="Last login" name="lastLogin" defaultValue={filters.lastLogin ?? ""}>
            {Object.entries(LAST_LOGIN_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </FilterSelect>

          {/* Preserved across every filter change — see the note above. */}
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="dir" value={filters.dir} />
          <input type="hidden" name="perPage" value={String(filters.perPage)} />

          <div className="ml-auto flex items-center gap-2">
            {active ? (
              <Link href={usersHref(filters, { q: "", roleId: null, schoolId: null, status: null, lastLogin: null })}>
                <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />}>
                  Clear filters
                </Button>
              </Link>
            ) : null}
            {/*
              A plain link, not a fetch: the browser's own download machinery
              handles the file, shows progress and survives a slow query far
              better than holding a CSV in memory to hand to a blob URL.
            */}
            <a href={exportHref} download>
              <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                Export
              </Button>
            </a>
          </div>
        </Toolbar>
      </AutoSubmitForm>
    </div>
  );
}
