"use client";

/**
 * Visual gallery of every editable marketing media slot.
 *
 * UX intent:
 *   • Every card carries its full page · section context as a colored chip
 *     — even when section headings have scrolled out of view you always
 *     know what you're looking at.
 *   • Always-visible actions; no hover-reveal.
 *   • Direct manipulation: drop a file on the card OR click to upload.
 *   • Colored by page (About/blue, Contact/green, Experience/violet, etc.)
 *     so the eye groups by location at a glance.
 *   • Each card has a "↗ Open page" link that jumps to the live URL in
 *     a new tab so the editor can verify where the image will appear.
 *   • "Default source: <filename>" hint clarifies when two slots happen
 *     to share the same default image — they're independent slots, the
 *     editor just sees the same starting state.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, RotateCcw, ExternalLink, Loader2, CheckCircle2, AlertTriangle,
  Film, Image as ImageIcon, Search,
} from "lucide-react";
import type { MediaSlot } from "@/lib/media-slots";
import { PAGE_COLORS, filenameFromUrl } from "@/lib/media-slots";
import { cn } from "@/lib/cn";

type Row = {
  slot: MediaSlot;
  url: string;
  alt: string | null;
  overridden: boolean;
};

const ASPECT_CLASS: Record<NonNullable<MediaSlot["aspect"]>, string> = {
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "4:5": "aspect-[4/5]",
  "3:4": "aspect-[3/4]",
  // "free" slots (e.g. login banner) have no fixed shape — give the box
  // a roomy default and let object-contain letterbox whatever was uploaded.
  free: "aspect-[4/3]",
};

export function MediaSlotsGallery({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [query, setQuery] = useState("");
  const [pageFilter, setPageFilter] = useState<MediaSlot["pageId"] | "all">("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const pages = useMemo(() => {
    const set = new Map<MediaSlot["pageId"], string>();
    for (const r of rows) set.set(r.slot.pageId, r.slot.pageLabel);
    return Array.from(set.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (pageFilter !== "all" && r.slot.pageId !== pageFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = `${r.slot.label} ${r.slot.section} ${r.slot.pageLabel} ${r.slot.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, pageFilter]);

  // Group filtered rows by page → section.
  const grouped = useMemo(() => {
    const map = new Map<string, { pageId: MediaSlot["pageId"]; sections: Map<string, Row[]> }>();
    for (const r of filtered) {
      const bucket = map.get(r.slot.pageLabel) ?? { pageId: r.slot.pageId, sections: new Map<string, Row[]>() };
      const sec = bucket.sections.get(r.slot.section) ?? [];
      sec.push(r);
      bucket.sections.set(r.slot.section, sec);
      map.set(r.slot.pageLabel, bucket);
    }
    return map;
  }, [filtered]);

  const flash = (t: { kind: "ok" | "err"; text: string }) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2200);
  };

  const replaceSlot = useCallback(
    async (slot: MediaSlot, file: File) => {
      const allowedVideo = /^video\//;
      const allowedImage = /^image\//;
      const ok =
        slot.kind === "video"
          ? allowedVideo.test(file.type)
          : slot.kind === "image"
            ? allowedImage.test(file.type)
            : allowedVideo.test(file.type) || allowedImage.test(file.type);
      if (!ok) {
        const expected =
          slot.kind === "video"
            ? "video"
            : slot.kind === "image"
              ? "image"
              : "image or video";
        flash({ kind: "err", text: `Expected ${expected} file` });
        return;
      }
      setBusyKey(slot.key);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "marketing");
        const up = await fetch("/api/admin/upload", { method: "POST", body: fd });
        if (!up.ok) {
          const d = await up.json().catch(() => ({}));
          throw new Error(d.error ?? "Upload failed");
        }
        const { url } = await up.json();

        const patch = await fetch(`/api/admin/content/${encodeURIComponent(slot.key)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { url, alt: file.name } }),
        });
        if (!patch.ok) {
          const d = await patch.json().catch(() => ({}));
          throw new Error(d.error ?? "Save failed");
        }
        setRows((cur) =>
          cur.map((r) =>
            r.slot.key === slot.key ? { ...r, url, alt: file.name, overridden: true } : r,
          ),
        );
        flash({ kind: "ok", text: "Updated — live within seconds" });
        router.refresh();
      } catch (e) {
        flash({ kind: "err", text: e instanceof Error ? e.message : "Upload failed" });
      } finally {
        setBusyKey(null);
      }
    },
    [router],
  );

  const resetSlot = useCallback(
    async (slot: MediaSlot) => {
      if (!confirm(`Reset "${slot.label}" to the original?`)) return;
      setBusyKey(slot.key);
      try {
        const patch = await fetch(`/api/admin/content/${encodeURIComponent(slot.key)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: {} }),
        });
        if (!patch.ok) throw new Error("Reset failed");
        setRows((cur) =>
          cur.map((r) =>
            r.slot.key === slot.key
              ? { ...r, url: slot.defaultUrl, alt: null, overridden: false }
              : r,
          ),
        );
        flash({ kind: "ok", text: "Reset to original" });
        router.refresh();
      } catch (e) {
        flash({ kind: "err", text: e instanceof Error ? e.message : "Reset failed" });
      } finally {
        setBusyKey(null);
      }
    },
    [router],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100/70 bg-white p-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slots…"
            className="h-9 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[13px] placeholder:text-ink-400 transition-[background,border,box-shadow] focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <PageTab active={pageFilter === "all"} onClick={() => setPageFilter("all")}>
            All <Counter n={rows.length} />
          </PageTab>
          {pages.map(([id, label]) => {
            const count = rows.filter((r) => r.slot.pageId === id).length;
            return (
              <PageTab key={id} active={pageFilter === id} onClick={() => setPageFilter(id)}>
                <span className={cn("inline-block h-1.5 w-1.5 rounded-full", PAGE_COLORS[id].bg.replace("-100", "-500"))} />
                {label} <Counter n={count} />
              </PageTab>
            );
          })}
        </div>
      </div>

      {/* Groups */}
      {Array.from(grouped.entries()).map(([pageLabel, { pageId, sections }]) => {
        const color = PAGE_COLORS[pageId];
        return (
          <section key={pageLabel} className="mb-8">
            <header className="mb-3 flex items-center gap-3">
              <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold uppercase tracking-wider", color.bg, color.text)}>
                {pageLabel}
              </span>
              <span className="text-[12px] text-ink-500">
                {Array.from(sections.values()).reduce((a, b) => a + b.length, 0)} slot{Array.from(sections.values()).reduce((a, b) => a + b.length, 0) === 1 ? "" : "s"}
              </span>
            </header>
            {Array.from(sections.entries()).map(([section, slotRows]) => (
              <div key={section} className="mb-6">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-500 mb-3">
                  {section}
                </h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {slotRows.map((row) => (
                    <MediaSlotCard
                      key={row.slot.key}
                      row={row}
                      busy={busyKey === row.slot.key}
                      onReplace={(f) => replaceSlot(row.slot, f)}
                      onReset={() => resetSlot(row.slot)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center text-ink-400 text-[13px]">
          No slots match your filter.
        </div>
      ) : null}

      {toast ? (
        <div
          className={cn(
            "fixed bottom-6 right-6 inline-flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg text-[13px] font-semibold z-50",
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white",
          )}
        >
          {toast.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

function Counter({ n }: { n: number }) {
  return <span className="ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-black/10 px-1.5 text-[10px] font-bold tabular-nums">{n}</span>;
}

function PageTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
        active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100 hover:text-ink-900",
      )}
    >
      {children}
    </button>
  );
}

function MediaSlotCard({
  row,
  busy,
  onReplace,
  onReset,
}: {
  row: Row;
  busy: boolean;
  onReplace: (file: File) => void;
  onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const { slot, url, overridden } = row;
  const aspect = ASPECT_CLASS[slot.aspect ?? "1:1"];
  const urlIsVideo = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv)(\?|$)/i.test(url);
  const renderAsVideo = slot.kind === "video" || (slot.kind === "any" && urlIsVideo);
  const Icon = renderAsVideo ? Film : ImageIcon;
  const color = PAGE_COLORS[slot.pageId];

  return (
    <div
      className={cn(
        "group rounded-2xl border bg-white overflow-hidden transition-all flex flex-col",
        drag
          ? "border-brand ring-2 ring-brand-200"
          : "border-ink-100 hover:border-ink-200 hover:shadow-[0_15px_30px_-20px_rgba(0,0,0,0.15)]",
      )}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onReplace(f);
      }}
    >
      {/* Context bar above the thumbnail — page + section, always visible. */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-100">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 h-6 text-[11px] font-bold uppercase tracking-wider",
            color.bg, color.text,
          )}
        >
          {slot.pageLabel}
        </span>
        <span className="text-ink-300 text-[12px]">·</span>
        <span className="text-[12px] font-semibold text-ink-700">{slot.section}</span>
        <a
          href={slot.pageHref}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this page in a new tab"
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-ink-500 hover:text-ink-900"
        >
          <ExternalLink className="h-3 w-3" /> View page
        </a>
      </div>

      {/* Thumbnail / drop zone */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative w-full block bg-[repeating-conic-gradient(theme(colors.ink.50)_0%_25%,white_0%_50%)] bg-[length:18px_18px]",
          aspect,
        )}
      >
        {renderAsVideo ? (
           
          <video
            key={url}
            src={url}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt={slot.label}
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}

        {/* Top-left: kind + status badges */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/65 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 backdrop-blur">
            <Icon className="h-3 w-3" />
            {slot.kind === "any" ? (renderAsVideo ? "video" : "image") : slot.kind}
          </span>
          {overridden ? (
            <span className="inline-flex items-center rounded-full bg-brand text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1">
              Custom
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-white/90 text-ink-700 text-[10px] font-bold uppercase tracking-wider px-2 py-1">
              Original
            </span>
          )}
        </div>

        {slot.aspect ? (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center rounded-full bg-black/65 text-white text-[10px] font-bold tracking-wider px-2 py-1 backdrop-blur">
            {slot.aspect}
          </span>
        ) : null}

        {/* Hover overlay */}
        <div className={cn(
          "absolute inset-0 grid place-items-center bg-ink-900/40 text-white opacity-0 group-hover:opacity-100 transition-opacity",
          drag && "opacity-100 bg-brand/60",
          busy && "opacity-100"
        )}>
          {busy ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <div className="text-center">
              <Upload className="h-7 w-7 mx-auto" />
              <p className="mt-2 text-[12px] font-semibold">
                {drag ? "Drop to replace" : "Click or drop a file"}
              </p>
              <p className="text-[10px] opacity-80 mt-0.5">
                {slot.kind === "video"
                  ? "MP4 / WebM, ≤ 500 MB"
                  : slot.kind === "image"
                    ? "PNG / JPG / WebP, ≤ 50 MB"
                    : "Image (≤ 50 MB) or Video (≤ 500 MB)"}
              </p>
            </div>
          )}
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={slot.kind === "video" ? "video/*" : slot.kind === "image" ? "image/*" : "image/*,video/*"}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onReplace(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      {/* Meta + actions */}
      <div className="p-3 border-t border-ink-100 flex-1 flex flex-col">
        <p className="text-[13px] font-semibold text-ink-900 leading-tight">
          {slot.label}
        </p>
        <p className="mt-1 text-[11px] text-ink-500 leading-snug">
          {slot.description}
        </p>
        <p className="mt-2 text-[10px] text-ink-400 font-mono truncate" title={overridden ? url : `Default: ${filenameFromUrl(slot.defaultUrl)}`}>
          {overridden
            ? `Custom: ${filenameFromUrl(url)}`
            : `Default: ${filenameFromUrl(slot.defaultUrl)}`}
        </p>
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-ink-900 text-white text-[12px] font-semibold hover:bg-ink-700 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> Replace
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={busy || !overridden}
            title={overridden ? "Reset to original" : "Already showing the original"}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-ink-200 text-ink-700 text-[12px] font-semibold hover:bg-cream-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the file in a new tab"
            className="ml-auto inline-flex items-center justify-center h-8 w-8 rounded-lg text-ink-500 hover:bg-cream-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
