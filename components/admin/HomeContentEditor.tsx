"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Trash2, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

/**
 * Friendly form-based editors for each well-known home.* block.
 * Falls back to raw JSON for any other key.
 */

export function HomeContentEditor({
  blockKey,
  initial,
}: {
  blockKey: string;
  initial: unknown;
}) {
  switch (blockKey) {
    case "home.hero":
      return <HeroEditor blockKey={blockKey} initial={initial as HeroData} />;
    case "home.sale_strip":
      return <SaleStripEditor blockKey={blockKey} initial={initial as SaleStripData} />;
    case "home.stats":
      return <StatsEditor blockKey={blockKey} initial={initial as StatRow[]} />;
    case "home.how_it_works":
      return <HowItWorksEditor blockKey={blockKey} initial={initial as Step[]} />;
    case "home.in_the_wild":
      return <InTheWildEditor blockKey={blockKey} initial={initial as InTheWildData} />;
    default:
      return <RawJsonEditor blockKey={blockKey} initial={initial} />;
  }
}

// ────────────────────────────────────────────────────────────
// Save helper used by every editor
// ────────────────────────────────────────────────────────────

function useSave(blockKey: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = (data: unknown) => {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await fetch(
        `/api/admin/content/${encodeURIComponent(blockKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return { save, pending, error, saved };
}

// ────────────────────────────────────────────────────────────
// home.hero
// ────────────────────────────────────────────────────────────

type HeroData = {
  eyebrow?: string;
  headlineTop?: string;
  headlineMid?: string;
  headlineHighlight?: string;
  headlineEnd?: string;
  sub?: string;
  ctaPrimary?: string;
  videoUrl?: string;
  videoCaption?: string;
};

function HeroEditor({ blockKey, initial }: { blockKey: string; initial: HeroData }) {
  const [d, setD] = useState<HeroData>(initial ?? {});
  const { save, pending, error, saved } = useSave(blockKey);
  const set = <K extends keyof HeroData>(k: K, v: HeroData[K]) =>
    setD((cur) => ({ ...cur, [k]: v }));

  return (
    <Wrapper title="Hero section" subtitle="Top-of-page banner with video and CTA">
      <Field label="Eyebrow" hint="Small badge above the headline">
        <input value={d.eyebrow ?? ""} onChange={(e) => set("eyebrow", e.target.value)} className={inputClass} />
      </Field>
      <Field label="Sub-headline">
        <textarea rows={3} value={d.sub ?? ""} onChange={(e) => set("sub", e.target.value)} className={inputClass + " py-2"} />
      </Field>
      <Field label="Primary CTA">
        <input value={d.ctaPrimary ?? ""} onChange={(e) => set("ctaPrimary", e.target.value)} className={inputClass} />
      </Field>
      <hr className="border-ink-100/70 my-3" />
      <Field label="Video URL" hint="MP4 hosted on your CDN — appears in the right-side card">
        <UrlWithUpload
          value={d.videoUrl ?? ""}
          onChange={(v) => set("videoUrl", v)}
          accept="video/*"
          folder="content/home/hero"
        />
      </Field>
      <Field label="Video caption" hint="Small overlay text on the video">
        <input value={d.videoCaption ?? ""} onChange={(e) => set("videoCaption", e.target.value)} className={inputClass} />
      </Field>
      <SaveBar onSave={() => save(d)} pending={pending} error={error} saved={saved} />
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// home.sale_strip
// ────────────────────────────────────────────────────────────

type SaleStripData = { items: string[] };

function SaleStripEditor({
  blockKey,
  initial,
}: {
  blockKey: string;
  initial: SaleStripData;
}) {
  const [items, setItems] = useState<string[]>(initial?.items ?? []);
  const { save, pending, error, saved } = useSave(blockKey);

  return (
    <Wrapper
      title="Sale strip (top marquee)"
      subtitle="Short phrases that scroll across the very top of the homepage"
    >
      <ListEditor
        items={items}
        onChange={setItems}
        placeholder="e.g. FREE SHIPPING ON KITS"
        addLabel="Add line"
      />
      <SaveBar onSave={() => save({ items })} pending={pending} error={error} saved={saved} />
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// home.stats
// ────────────────────────────────────────────────────────────

type StatRow = { value: number; suffix?: string; label: string };

function StatsEditor({ blockKey, initial }: { blockKey: string; initial: StatRow[] }) {
  const [rows, setRows] = useState<StatRow[]>(initial ?? []);
  const { save, pending, error, saved } = useSave(blockKey);

  const upd = (i: number, patch: Partial<StatRow>) =>
    setRows((arr) => arr.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Wrapper title="Stats" subtitle="The four big numbers near the bottom of the homepage">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-12 gap-2 items-start border border-ink-100 rounded-lg p-2 bg-cream-50/40"
          >
            <input
              type="number"
              value={r.value}
              onChange={(e) => upd(i, { value: Number(e.target.value) || 0 })}
              className={inputClass + " col-span-3"}
              placeholder="Value"
            />
            <input
              value={r.suffix ?? ""}
              onChange={(e) => upd(i, { suffix: e.target.value })}
              className={inputClass + " col-span-2"}
              placeholder="+ / % / d"
            />
            <input
              value={r.label}
              onChange={(e) => upd(i, { label: e.target.value })}
              className={inputClass + " col-span-6"}
              placeholder="Label e.g. Happy students"
            />
            <button
              type="button"
              onClick={() => setRows((arr) => arr.filter((_, idx) => idx !== i))}
              className="col-span-1 grid place-items-center h-9 rounded-lg text-ink-400 hover:text-red-600 hover:bg-red-50"
              aria-label="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((arr) => [...arr, { value: 0, suffix: "", label: "" }])}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
        >
          <Plus className="h-3.5 w-3.5" /> Add stat
        </button>
      </div>
      <SaveBar onSave={() => save(rows)} pending={pending} error={error} saved={saved} />
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// home.how_it_works
// ────────────────────────────────────────────────────────────

type Step = { n: string; icon: string; title: string; body: string };

const ICON_OPTIONS = ["Search", "Package", "Truck"];

function HowItWorksEditor({
  blockKey,
  initial,
}: {
  blockKey: string;
  initial: Step[];
}) {
  const [steps, setSteps] = useState<Step[]>(initial ?? []);
  const { save, pending, error, saved } = useSave(blockKey);

  const upd = (i: number, patch: Partial<Step>) =>
    setSteps((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <Wrapper title="How it works" subtitle="Three numbered steps shown on the homepage">
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div
            key={i}
            className="grid grid-cols-12 gap-2 items-start border border-ink-100 rounded-lg p-3 bg-cream-50/40"
          >
            <input
              value={s.n}
              onChange={(e) => upd(i, { n: e.target.value })}
              className={inputClass + " col-span-2"}
              placeholder="01"
            />
            <select
              value={s.icon}
              onChange={(e) => upd(i, { icon: e.target.value })}
              className={inputClass + " col-span-3"}
            >
              {ICON_OPTIONS.map((ic) => (
                <option key={ic} value={ic}>
                  {ic}
                </option>
              ))}
            </select>
            <input
              value={s.title}
              onChange={(e) => upd(i, { title: e.target.value })}
              className={inputClass + " col-span-6"}
              placeholder="Title"
            />
            <button
              type="button"
              onClick={() =>
                setSteps((arr) => arr.filter((_, idx) => idx !== i))
              }
              className="col-span-1 grid place-items-center h-9 rounded-lg text-ink-400 hover:text-red-600 hover:bg-red-50"
              aria-label="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <textarea
              value={s.body}
              onChange={(e) => upd(i, { body: e.target.value })}
              rows={2}
              className={inputClass + " py-2 col-span-12"}
              placeholder="Body copy"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setSteps((arr) => [
              ...arr,
              { n: String(arr.length + 1).padStart(2, "0"), icon: "Search", title: "", body: "" },
            ])
          }
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
        >
          <Plus className="h-3.5 w-3.5" /> Add step
        </button>
      </div>
      <SaveBar onSave={() => save(steps)} pending={pending} error={error} saved={saved} />
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// home.in_the_wild — heading, sub, clips with video URLs and uploads
// ────────────────────────────────────────────────────────────

type Clip = { src: string; caption: string; meta: string; poster?: string };
type InTheWildData = { heading: string; sub: string; clips: Clip[] };

function InTheWildEditor({
  blockKey,
  initial,
}: {
  blockKey: string;
  initial: InTheWildData;
}) {
  const [d, setD] = useState<InTheWildData>(
    initial ?? { heading: "", sub: "", clips: [] }
  );
  const { save, pending, error, saved } = useSave(blockKey);

  const updClip = (i: number, patch: Partial<Clip>) =>
    setD((cur) => ({
      ...cur,
      clips: cur.clips.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));

  return (
    <Wrapper title="In the wild" subtitle="Mosaic of three school videos. The first appears large.">
      <Field label="Heading">
        <input
          value={d.heading}
          onChange={(e) => setD({ ...d, heading: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="Sub-text">
        <textarea
          rows={2}
          value={d.sub}
          onChange={(e) => setD({ ...d, sub: e.target.value })}
          className={inputClass + " py-2"}
        />
      </Field>

      <div className="mt-4 space-y-3">
        <span className="text-[12px] font-semibold text-ink-700">Clips (need 3)</span>
        {d.clips.map((c, i) => (
          <div
            key={i}
            className="border border-ink-100 rounded-xl p-3 bg-cream-50/40 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Clip {i + 1}
              </span>
              <button
                type="button"
                onClick={() =>
                  setD({ ...d, clips: d.clips.filter((_, idx) => idx !== i) })
                }
                className="text-ink-400 hover:text-red-600"
                aria-label="Remove clip"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <Field label="Video URL">
              <UrlWithUpload
                value={c.src}
                onChange={(v) => updClip(i, { src: v })}
                accept="video/*"
                folder="content/home/in-the-wild"
              />
            </Field>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              <Field label="Caption">
                <input
                  value={c.caption}
                  onChange={(e) => updClip(i, { caption: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Meta (school + occasion)">
                <input
                  value={c.meta}
                  onChange={(e) => updClip(i, { meta: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        ))}
        {d.clips.length < 6 ? (
          <button
            type="button"
            onClick={() =>
              setD({
                ...d,
                clips: [...d.clips, { src: "", caption: "", meta: "" }],
              })
            }
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
          >
            <Plus className="h-3.5 w-3.5" /> Add clip
          </button>
        ) : null}
      </div>
      <SaveBar onSave={() => save(d)} pending={pending} error={error} saved={saved} />
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// Raw JSON fallback
// ────────────────────────────────────────────────────────────

function RawJsonEditor({
  blockKey,
  initial,
}: {
  blockKey: string;
  initial: unknown;
}) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const { save, pending, error, saved } = useSave(blockKey);
  const [parseErr, setParseErr] = useState<string | null>(null);

  const onSave = () => {
    try {
      const data = JSON.parse(text);
      setParseErr(null);
      save(data);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <Wrapper title="Raw JSON" subtitle="No structured editor for this block — edit the JSON directly.">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={20}
        className="w-full rounded-xl border border-ink-200 bg-cream-50 px-3 py-2.5 text-[12px] font-mono outline-none focus:border-ink-900 leading-relaxed"
      />
      {parseErr ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{parseErr}</span>
        </div>
      ) : null}
      <SaveBar onSave={onSave} pending={pending} error={error} saved={saved} />
    </Wrapper>
  );
}

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

function Wrapper({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:p-6 space-y-3">
      <div className="border-b border-ink-100/70 pb-3">
        <h3 className="font-display text-[16px] font-bold text-ink-900">{title}</h3>
        <p className="text-[12px] text-ink-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function ListEditor({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={it}
            onChange={(e) =>
              onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))
            }
            placeholder={placeholder}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="grid place-items-center h-9 w-9 rounded-lg text-ink-400 hover:text-red-600 hover:bg-red-50"
            aria-label="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-900"
      >
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </button>
    </div>
  );
}

function UrlWithUpload({
  value,
  onChange,
  accept,
  folder,
}: {
  value: string;
  onChange: (next: string) => void;
  accept: string;
  folder: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "Upload failed");
      }
      const { url } = await r.json();
      onChange(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass + " font-mono text-[12px]"}
          placeholder="https://…"
        />
        <label className="inline-flex items-center justify-center gap-1 h-9 px-3 rounded-lg border border-ink-200 bg-white hover:bg-cream-100 cursor-pointer text-[12px] font-semibold text-ink-700 whitespace-nowrap">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "…" : "Upload"}
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </label>
      </div>
      {err ? (
        <p className="mt-1 text-[11px] text-red-700">{err}</p>
      ) : value ? (
        <p className="mt-1 text-[11px] text-ink-400 truncate">{value}</p>
      ) : null}
    </div>
  );
}

function SaveBar({
  onSave,
  pending,
  error,
  saved,
}: {
  onSave: () => void;
  pending: boolean;
  error: string | null;
  saved: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-3 border-t border-ink-100/70">
      {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
      {saved ? <span className="text-[13px] text-emerald-700">✓ Saved</span> : null}
      <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} onClick={onSave}>
        Save block
      </Button>
    </div>
  );
}
