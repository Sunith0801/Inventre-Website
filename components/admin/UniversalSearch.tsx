"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-nav";
import { canSeePage } from "@/lib/admin-permissions";
import { cn } from "@/lib/cn";

/**
 * Universal search over every sidebar nav item. Type to filter by label
 * or section. Enter on the highlighted item to navigate. Cmd/Ctrl+K
 * focuses the input from anywhere on the dashboard.
 */
export function UniversalSearch({ permissions }: { permissions: string[] }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems = useMemo(() => {
    const perms = new Set(permissions);
    return ADMIN_NAV_GROUPS.flatMap((g) =>
      g.items
        .filter((it) => canSeePage(perms, it.perm))
        .map((it) => ({ ...it, kicker: g.kicker }))
    );
  }, [permissions]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [] as typeof allItems;
    return allItems.filter(
      (it) =>
        it.label.toLowerCase().includes(needle) ||
        it.kicker.toLowerCase().includes(needle)
    );
  }, [q, allItems]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mb-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (matches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(matches.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const target = matches[active];
              if (target) router.push(target.href);
            } else if (e.key === "Escape") {
              setQ("");
            }
          }}
          placeholder="Search pages…   (Cmd/Ctrl+K)"
          className="w-full pl-10 pr-4 py-3 text-[14px] bg-white border border-ink-200 rounded-xl focus:border-ink-400 focus:outline-none placeholder:text-ink-400 shadow-sm"
        />
      </div>
      {matches.length > 0 && (
        <div className="mt-2 rounded-xl border border-ink-100 bg-white shadow-sm overflow-hidden">
          {matches.slice(0, 8).map((it, i) => (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 text-[13px] border-b last:border-b-0 border-ink-100",
                i === active
                  ? "bg-ink-900 text-white"
                  : "text-ink-700 hover:bg-cream-50"
              )}
            >
              <it.icon
                className={cn(
                  "h-4 w-4",
                  i === active ? "text-white" : "text-ink-400"
                )}
              />
              <span className="font-medium">{it.label}</span>
              <span
                className={cn(
                  "ml-auto text-[10px] uppercase tracking-wider",
                  i === active ? "text-white/70" : "text-ink-400"
                )}
              >
                {it.kicker}
              </span>
            </Link>
          ))}
          {matches.length > 8 && (
            <div className="px-4 py-1.5 text-[11px] text-ink-400 bg-cream-50">
              + {matches.length - 8} more — keep typing to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}
