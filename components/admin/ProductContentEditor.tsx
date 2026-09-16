"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Save,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Upload,
  Loader2,
  Check,
} from "lucide-react";
import { Card, CardHeader, Field, Input, Textarea, FormError, Th, Td, Tr } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";
import { cn } from "@/lib/cn";
import { DEFAULT_SIZE_COLUMNS, sizeChartColumns, type SizeChartRow } from "@/lib/size-chart";

/**
 * Everything a parent reads on the product page besides price and images:
 * description paragraphs, the note under the image, the Specs & Care rows
 * and the size guide (chart image + size table). One card, one Save.
 */

type SpecRow = { label: string; value: string };
type SizeRow = SizeChartRow;

function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">{title}</h4>
      {action}
    </div>
  );
}

export function ProductContentEditor({
  productId,
  initialDescription,
  initialSpecs,
  initialSizeTable,
  initialSizeChartUrl,
  initialImageNote,
}: {
  productId: string;
  initialDescription: string[] | null;
  initialSpecs: SpecRow[] | null;
  initialSizeTable: SizeRow[] | null;
  initialSizeChartUrl: string | null;
  initialImageNote: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [desc, setDesc] = useState<string[]>(
    initialDescription && initialDescription.length > 0 ? initialDescription : [""]
  );
  const [specs, setSpecs] = useState<SpecRow[]>(
    initialSpecs && initialSpecs.length > 0 ? initialSpecs : [{ label: "", value: "" }]
  );
  const [sizeTable, setSizeTable] = useState<SizeRow[]>(
    initialSizeTable && initialSizeTable.length > 0 ? initialSizeTable : []
  );
  // The chart's measurement columns are the admin's to define — chest /
  // length / sleeve for a shirt, waist / inseam for trousers, UK / EU for
  // shoes. Kept as ordered keys on every row so the JSON stays the truth.
  const [columns, setColumns] = useState<string[]>(() => {
    const c = sizeChartColumns(initialSizeTable);
    return c.length ? c : [...DEFAULT_SIZE_COLUMNS];
  });
  const rowFor = (cols: string[], base?: Partial<SizeRow>): SizeRow => {
    const r: SizeRow = { size: base?.size ?? "" };
    for (const c of cols) r[c] = base?.[c] ?? "";
    return r;
  };
  const addColumn = () => {
    let name = "measure";
    let n = 1;
    while (columns.includes(name)) name = `measure ${++n}`;
    const cols = [...columns, name];
    setColumns(cols);
    setSizeTable(sizeTable.map((r) => rowFor(cols, r)));
    dirty();
  };
  const renameColumn = (i: number, name: string) => {
    const clean = name.trim().toLowerCase();
    if (!clean || clean === "size" || columns.some((c, j) => j !== i && c === clean)) return;
    const cols = columns.map((c, j) => (j === i ? clean : c));
    setColumns(cols);
    setSizeTable(sizeTable.map((r) => { const nr = rowFor(cols); nr.size = r.size; cols.forEach((c, j) => { nr[c] = r[j === i ? columns[i]! : c] ?? ""; }); return nr; }));
    dirty();
  };
  const removeColumn = (i: number) => {
    const cols = columns.filter((_, j) => j !== i);
    setColumns(cols);
    setSizeTable(sizeTable.map((r) => rowFor(cols, r)));
    dirty();
  };
  const [sizeChartUrl, setSizeChartUrl] = useState<string | null>(initialSizeChartUrl);
  const [imageNote, setImageNote] = useState<string>(initialImageNote ?? "");
  const [uploadingChart, setUploadingChart] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = () => setSaved(false);

  const submit = () => {
    setError(null);
    start(async () => {
      const cleanDesc = desc.map((s) => s.trim()).filter(Boolean);
      const cleanSpecs = specs.filter((r) => r.label.trim() && r.value.trim());
      const cleanSizeTable = sizeTable.filter((r) => r.size.trim());
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: cleanDesc.length > 0 ? cleanDesc : null,
          specs: cleanSpecs.length > 0 ? cleanSpecs : null,
          sizeTable: cleanSizeTable.length > 0 ? cleanSizeTable : null,
          sizeChartUrl: sizeChartUrl || null,
          imageNote: imageNote.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const uploadChart = async (file: File) => {
    setUploadingChart(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", `products/${productId}/size-chart`);
      const up = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!up.ok) throw new Error("Upload failed");
      const { url } = await up.json();
      setSizeChartUrl(url);
      dirty();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingChart(false);
    }
  };

  const updateDesc = (i: number, v: string) => {
    setDesc(desc.map((p, idx) => (idx === i ? v : p)));
    dirty();
  };
  const moveDesc = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= desc.length) return;
    const copy = [...desc];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setDesc(copy);
    dirty();
  };
  const updateSpec = (i: number, k: keyof SpecRow, v: string) => {
    setSpecs(specs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    dirty();
  };
  const updateSize = (i: number, k: string, v: string) => {
    setSizeTable(sizeTable.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    dirty();
  };

  return (
    <Card>
      <CardHeader title="Shop content" description="What parents read on the product page." />

      <div className="space-y-6">
        {/* Description */}
        <section>
          <SectionHeading
            title="Description"
            action={
              <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setDesc([...desc, ""]); dirty(); }}>
                Paragraph
              </Button>
            }
          />
          <div className="space-y-2">
            {desc.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Textarea
                  value={p}
                  onChange={(e) => updateDesc(i, e.target.value)}
                  rows={3}
                  placeholder="A customer-facing paragraph…"
                  aria-label={`Paragraph ${i + 1}`}
                />
                <div className="flex flex-col gap-1">
                  <IconAction onClick={() => moveDesc(i, -1)} disabled={i === 0} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></IconAction>
                  <IconAction onClick={() => moveDesc(i, 1)} disabled={i === desc.length - 1} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></IconAction>
                  <IconAction onClick={() => { setDesc(desc.filter((_, idx) => idx !== i)); dirty(); }} destructive title="Remove paragraph"><Trash2 className="h-3.5 w-3.5" /></IconAction>
                </div>
              </div>
            ))}
            {desc.length === 0 ? <p className="text-[12.5px] text-ink-500">No description — the shop shows a generic one.</p> : null}
          </div>
        </section>

        {/* Note under image */}
        <section className="border-t border-ink-100/70 pt-5">
          <Field label="Note under image" htmlFor="pc-image-note">
            <Textarea
              id="pc-image-note"
              value={imageNote}
              onChange={(e) => { setImageNote(e.target.value); dirty(); }}
              rows={2}
              placeholder="e.g. Care: machine wash cold. Genuine Inventre product — QC tested."
            />
          </Field>
        </section>

        {/* Specs & Care */}
        <section className="border-t border-ink-100/70 pt-5">
          <SectionHeading
            title="Specs & Care"
            action={
              <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setSpecs([...specs, { label: "", value: "" }]); dirty(); }}>
                Spec
              </Button>
            }
          />
          <div className="space-y-2">
            {specs.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <Input value={row.label} placeholder="Label, e.g. Fabric" aria-label="Spec label" onChange={(e) => updateSpec(i, "label", e.target.value)} />
                <Input value={row.value} placeholder="Value, e.g. 65% poly-cotton" aria-label="Spec value" onChange={(e) => updateSpec(i, "value", e.target.value)} />
                <IconAction onClick={() => { setSpecs(specs.filter((_, idx) => idx !== i)); dirty(); }} destructive title="Remove spec"><Trash2 className="h-3.5 w-3.5" /></IconAction>
              </div>
            ))}
          </div>
        </section>

        {/* Size guide */}
        <section className="border-t border-ink-100/70 pt-5">
          <SectionHeading
            title="Size guide"
            action={
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addColumn}>
                  Column
                </Button>
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setSizeTable([...sizeTable, rowFor(columns)]); dirty(); }}>
                  Size row
                </Button>
              </span>
            }
          />
          <div className="grid gap-4 md:grid-cols-[112px_minmax(0,1fr)]">
            <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-xl border border-ink-100 bg-cream-50">
              {sizeChartUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sizeChartUrl} alt="Size chart" className="h-full w-full object-contain p-2" />
              ) : (
                <ImageIcon className="h-7 w-7 text-ink-300" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadChart(f);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" busy={uploadingChart} onClick={() => fileRef.current?.click()} icon={uploadingChart ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}>
                  {sizeChartUrl ? "Replace chart image" : "Upload chart image"}
                </Button>
                {sizeChartUrl ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setSizeChartUrl(null); dirty(); }}>Remove</Button>
                ) : null}
              </div>
              <Input
                type="url"
                value={sizeChartUrl ?? ""}
                onChange={(e) => { setSizeChartUrl(e.target.value || null); dirty(); }}
                placeholder="…or paste an image URL"
                aria-label="Size chart image URL"
                className="font-mono"
              />
            </div>
          </div>

          {sizeTable.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-ink-100/70">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Size</Th>
                    {columns.map((c, ci) => (
                      <Th key={ci}>
                        <span className="inline-flex items-center gap-1">
                          <input
                            value={c}
                            aria-label="Column name"
                            onChange={(e) => renameColumn(ci, e.target.value)}
                            className="h-6 w-24 rounded border border-transparent bg-transparent px-1 text-[12px] font-semibold capitalize hover:border-ink-200 focus:border-ink-400 focus:outline-none"
                          />
                          <button type="button" onClick={() => removeColumn(ci)} title="Remove column" className="rounded p-0.5 text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                        </span>
                      </Th>
                    ))}
                    <Th right><span className="sr-only">Remove</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {sizeTable.map((row, i) => (
                    <Tr key={i}>
                      {["size", ...columns].map((k) => (
                        <Td key={k} className="!py-1.5">
                          <Input inputSize="sm" value={row[k] ?? ""} aria-label={k} onChange={(e) => updateSize(i, k, e.target.value)} className={k === "size" ? "w-24" : "w-28"} />
                        </Td>
                      ))}
                      <Td right className="!py-1.5">
                        <IconAction onClick={() => { setSizeTable(sizeTable.filter((_, idx) => idx !== i)); dirty(); }} destructive title="Remove row"><Trash2 className="h-3.5 w-3.5" /></IconAction>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-ink-500">No size rows — the shop hides the size guide.</p>
          )}
        </section>
      </div>

      <FormError className="mt-5">{error}</FormError>
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-ink-100/70 pt-4">
        {saved ? <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" /> Saved</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} onClick={submit}>
          Save content
        </Button>
      </div>
    </Card>
  );
}

function IconAction({
  onClick,
  disabled,
  destructive,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md text-ink-400 transition-colors disabled:opacity-30",
        destructive ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-cream-100 hover:text-ink-900"
      )}
    >
      {children}
    </button>
  );
}
