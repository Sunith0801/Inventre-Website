"use client";

/**
 * Overflow menu ("⋯" / actions) for the admin panel.
 *
 * ── Why this portals ────────────────────────────────────────────────────
 * The obvious build is an absolutely-positioned panel inside the trigger's
 * wrapper. That breaks the moment the trigger sits inside a table with a
 * horizontal scroll rail — `overflow-x: auto` establishes a clipping context,
 * so the menu on the last row renders *inside* the rail and gets cut off or,
 * worse, extends the scroll width. Since the Users table is exactly that,
 * the panel renders into `document.body` with fixed positioning computed
 * from the trigger's rect. It cannot be clipped by any ancestor.
 *
 * The trade-off is that a fixed-position panel does not follow its trigger
 * when the page scrolls, so the menu closes on scroll — which is also what
 * every desktop application does, and cheaper than tracking on every frame.
 *
 * ── Keyboard contract ───────────────────────────────────────────────────
 *   Enter/Space on trigger  open, focus first item
 *   ArrowDown / ArrowUp     move between items, wrapping
 *   Home / End              first / last item
 *   Escape                  close, return focus to the trigger
 *   Tab                     close (focus moves on naturally)
 *   click outside           close
 *
 * Focus returning to the trigger on close is the part usually skipped, and
 * the reason keyboard users get dumped at the top of the document after
 * every menu interaction.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";

// ════════════════════════════════════════════════════════════════════
// Item model
// ════════════════════════════════════════════════════════════════════

export type MenuItem =
  | {
      kind?: "item";
      label: string;
      /** Pre-rendered glyph, e.g. <Pencil className="h-3.5 w-3.5" />. */
      icon?: React.ReactNode;
      /** Renders a Link. Mutually exclusive with `onSelect`. */
      href?: string;
      onSelect?: () => void;
      /** Destructive actions render red and sit below a separator. */
      danger?: boolean;
      disabled?: boolean;
      /** Shown when disabled — explains WHY, which a greyed row never does. */
      disabledReason?: string;
    }
  | { kind: "separator" }
  | { kind: "label"; label: string };

type Placement = { top: number; left: number; width: number };

const MENU_WIDTH = 216;
const VIEWPORT_MARGIN = 8;

/**
 * Positions the panel under the trigger, flipping above when there is not
 * enough room below and clamping to the viewport horizontally so a menu on a
 * right-hand column never renders off-screen.
 */
function place(trigger: DOMRect, panelHeight: number): Placement {
  const spaceBelow = window.innerHeight - trigger.bottom;
  const flip = spaceBelow < panelHeight + VIEWPORT_MARGIN && trigger.top > panelHeight;

  const top = flip ? trigger.top - panelHeight - 4 : trigger.bottom + 4;

  // Right-align to the trigger, then clamp into the viewport.
  const idealLeft = trigger.right - MENU_WIDTH;
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, idealLeft),
    window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
  );

  return { top, left, width: MENU_WIDTH };
}

export function Menu({
  items,
  label = "Actions",
  trigger,
  align: _align,
}: {
  items: MenuItem[];
  /** Accessible name for the trigger. */
  label?: string;
  /** Custom trigger. Defaults to the "⋯" icon button. */
  trigger?: React.ReactNode;
  align?: "end";
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<Placement | null>(null);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Indices of the items that can actually take focus.
  const focusable = React.useMemo(
    () =>
      items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => (it.kind ?? "item") === "item" && !("disabled" in it && it.disabled))
        .map(({ i }) => i),
    [items]
  );
  const [activeIdx, setActiveIdx] = React.useState<number | null>(null);

  const close = React.useCallback(
    (returnFocus = true) => {
      setOpen(false);
      setActiveIdx(null);
      if (returnFocus) triggerRef.current?.focus();
    },
    []
  );

  // Measure once the panel is in the DOM, so the flip decision uses the real
  // height rather than an estimate.
  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const h = panelRef.current?.offsetHeight ?? items.length * 34 + 12;
    setPos(place(triggerRef.current.getBoundingClientRect(), h));
  }, [open, items.length]);

  // Dismissal: outside click, scroll, resize. Capture phase for scroll so it
  // fires for scrolling containers too, not just the window.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onScrollOrResize = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  // Move DOM focus to whichever item is active.
  React.useEffect(() => {
    if (activeIdx === null) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.focus();
  }, [activeIdx]);

  const step = (delta: 1 | -1) => {
    if (focusable.length === 0) return;
    const at = activeIdx === null ? -1 : focusable.indexOf(activeIdx);
    const next = at === -1 ? (delta === 1 ? 0 : focusable.length - 1) : at + delta;
    // Wrap rather than stop — a five-item menu should not need six keystrokes
    // to get from the last item back to the first.
    setActiveIdx(focusable[(next + focusable.length) % focusable.length]);
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); step(1); break;
      case "ArrowUp": e.preventDefault(); step(-1); break;
      case "Home": e.preventDefault(); setActiveIdx(focusable[0] ?? null); break;
      case "End": e.preventDefault(); setActiveIdx(focusable[focusable.length - 1] ?? null); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": close(false); break;
    }
  };

  const panel =
    open && pos ? (
      <div
        ref={panelRef}
        role="menu"
        aria-label={label}
        onKeyDown={onPanelKeyDown}
        style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
        className={cn(
          "z-50 rounded-xl border border-ink-100 bg-white py-1",
          "shadow-[0_16px_40px_-12px_rgba(10,10,10,0.22)]"
        )}
      >
        {items.map((item, i) => {
          if (item.kind === "separator") {
            return <div key={i} role="separator" className="my-1 h-px bg-ink-100" />;
          }
          if (item.kind === "label") {
            return (
              <div
                key={i}
                className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400"
              >
                {item.label}
              </div>
            );
          }

          const skin = cn(
            "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors",
            "focus:outline-none focus-visible:bg-cream-100",
            item.disabled
              ? "cursor-not-allowed text-ink-300"
              : item.danger
                ? "text-red-600 hover:bg-red-50 focus-visible:bg-red-50"
                : "text-ink-700 hover:bg-cream-100 hover:text-ink-900"
          );

          const body = (
            <>
              {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </>
          );

          if (item.disabled) {
            return (
              <div
                key={i}
                role="menuitem"
                aria-disabled="true"
                title={item.disabledReason}
                className={skin}
              >
                {body}
              </div>
            );
          }

          if (item.href) {
            return (
              <Link
                key={i}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                data-idx={i}
                className={skin}
                onClick={() => close(false)}
              >
                {body}
              </Link>
            );
          }

          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-idx={i}
              className={skin}
              onClick={() => {
                // Close BEFORE the handler: an action that opens a dialog
                // should not leave the menu stacked underneath it.
                close(false);
                item.onSelect?.();
              }}
            >
              {body}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
            setActiveIdx(focusable[0] ?? null);
          }
        }}
        className={cn(
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
          trigger
            // A custom trigger brings its own look (pass a styled <span>, never
            // a <button> — this IS the button). The default is the ⋯ icon.
            ? "inline-flex rounded-lg"
            : cn(
                "grid h-8 w-8 place-items-center rounded-lg text-ink-500 transition-colors",
                "hover:bg-ink-100/70 hover:text-ink-900",
                open && "bg-ink-100/70 text-ink-900"
              )
        )}
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" />}
      </button>
      {/* Portalled so no ancestor's overflow can clip it. `document` is only
          touched inside the effect-driven render, never during SSR. */}
      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
