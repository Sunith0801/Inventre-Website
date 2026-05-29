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
} from "lucide-react";
import { Card, CardHeader } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";
import { cn } from "@/lib/cn";

/**
 * Editor for the storefront-visible PDP content the admin previously could
 * not touch: description paragraphs, spec rows, size-chart image URL, and
 * the size-table grid (for the size-guide accordion).
 */

type SpecRow = { label: string; value: string };
type SizeRow = { size: string; chest: string; length: string; sleeve: string };

export function ProductContentEditor({
  productId,
  initialDescription,
  initialSpecs,
  initialSizeTable,
  initialSizeChartUrl,
}: {
  productId: string;
  initialDescription: string[] | null;
  initialSpecs: SpecRow[] | null;
  initialSizeTable: SizeRow[] | null;
  initialSizeChartUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [desc, setDesc] = useState<string[]>(
    initialDescription && initialDescription.length > 0
      ? initialDescription
      : [""]
  );
  const [specs, setSpecs] = useState<SpecRow[]>(
    initialSpecs && initialSpecs.length > 0
      ? initialSpecs
      : [{ label: "", value: "" }]
  );
  const [sizeTable, setSizeTable] = useState<SizeRow[]>(
    initialSizeTable && initialSizeTable.length > 0 ? initialSizeTable : []
  );
  const [sizeChartUrl, setSizeChartUrl] = useState<string | null>(
    initialSizeChartUrl
  );
  const [uploadingChart, setUploadingChart] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = () => setSaved(false);

  const submit = () => {
    setError(null);
    start(async () => {
      const cleanDesc = desc.map((s) => s.trim()).filter(Boolean);
      const cleanSpecs = specs.filter(
        (r) => r.label.trim() && r.value.trim()
      );
      const cleanSizeTable = sizeTable.filter((r) => r.size.trim());
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: cleanDesc.length > 0 ? cleanDesc : null,
          specs: cleanSpecs.length > 0 ? cleanSpecs : null,
          sizeTable: cleanSizeTable.length > 0 ? cleanSizeTable : null,
          sizeChartUrl: sizeChartUrl || null,
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

  // ── Description helpers ─────────────────────────────────────
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

  // ── Specs helpers ───────────────────────────────────────────
  const updateSpec = (i: number, k: keyof SpecRow, v: string) => {
    setSpecs(specs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    dirty();
  };

  // ── Size table helpers ──────────────────────────────────────
  const updateSize = (i: number, k: keyof SizeRow, v: string) => {
    setSizeTable(sizeTable.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    dirty();
  };

  return (
    <div className="space-y-5">
      {/* Description */}
      <Card>
        <CardHeader
          title="Description"
          description="Each paragraph appears as one block under the Description tab on the product page."
          actions={
            <button
              type="button"
              onClick={() => {
                setDesc([...desc, ""]);
                dirty();
              }}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:text-brand-700"
            >
              <Plus className="h-3 w-3" /> Paragraph
            </button>
          }
        />
        <div className="space-y-3">
          {desc.map((p, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                value={p}
                onChange={(e) => updateDesc(i, e.target.value)}
                rows={3}
                placeholder="Write a customer-facing description paragraph…"
                className="flex-1 rounded-lg border border-ink-200 bg-white p-3 text-[13px] outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 resize-y"
              />
              <div className="flex flex-col gap-1">
                <IconAction onClick={() => moveDesc(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </IconAction>
                <IconAction
                  onClick={() => moveDesc(i, 1)}
                  disabled={i === desc.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </IconAction>
                <IconAction
                  onClick={() => {
                    setDesc(desc.filter((_, idx) => idx !== i));
                    dirty();
                  }}
                  destructive
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconAction>
              </div>
            </div>
          ))}
          {desc.length === 0 ? (
            <p className="text-[12px] text-ink-500">
              No description set — the storefront will fall back to a generic
              one. Click <strong>Paragraph</strong> to add.
            </p>
          ) : null}
        </div>
      </Card>

      {/* Specs */}
      <Card>
        <CardHeader
          title="Specs & Care"
          description='Label / value pairs shown on the "Specs & Care" tab.'
          actions={
            <button
              type="button"
              onClick={() => {
                setSpecs([...specs, { label: "", value: "" }]);
                dirty();
              }}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:text-brand-700"
            >
              <Plus className="h-3 w-3" /> Spec
            </button>
          }
        />
        <div className="space-y-2">
          {specs.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
              <input
                type="text"
                value={row.label}
                placeholder="Label (e.g. Fabric)"
                onChange={(e) => updateSpec(i, "label", e.target.value)}
                className={inputClass}
              />
              <input
                type="text"
                value={row.value}
                placeholder="Value (e.g. 65% poly-cotton)"
                onChange={(e) => updateSpec(i, "value", e.target.value)}
                className={inputClass}
              />
              <IconAction
                onClick={() => {
                  setSpecs(specs.filter((_, idx) => idx !== i));
                  dirty();
                }}
                destructive
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconAction>
            </div>
          ))}
        </div>
      </Card>

      {/* Size chart image */}
      <Card>
        <CardHeader
          title="Size chart image"
          description="Optional reference image shown alongside the size guide accordion."
        />
        <div className="flex items-start gap-4">
          <div className="w-32 h-32 rounded-xl border border-ink-200 bg-cream-50 overflow-hidden grid place-items-center">
            {sizeChartUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sizeChartUrl}
                alt="Size chart"
                className="w-full h-full object-contain p-2"
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-ink-300" />
            )}
          </div>
          <div className="flex-1 space-y-2">
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                busy={uploadingChart}
                onClick={() => fileRef.current?.click()}
                icon={
                  uploadingChart ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )
                }
              >
                {sizeChartUrl ? "Replace image" : "Upload image"}
              </Button>
              {sizeChartUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setSizeChartUrl(null);
                    dirty();
                  }}
                  className="text-[12px] text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <input
              type="url"
              value={sizeChartUrl ?? ""}
              onChange={(e) => {
                setSizeChartUrl(e.target.value || null);
                dirty();
              }}
              placeholder="…or paste a URL"
              className={inputClass}
            />
          </div>
        </div>
      </Card>

      {/* Size table */}
      <Card>
        <CardHeader
          title="Size table"
          description="Numeric measurements (in inches) shown in the size-guide accordion. Only the size column is required."
          actions={
            <button
              type="button"
              onClick={() => {
                setSizeTable([
                  ...sizeTable,
                  { size: "", chest: "", length: "", sleeve: "" },
                ]);
                dirty();
              }}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:text-brand-700"
            >
              <Plus className="h-3 w-3" /> Row
            </button>
          }
        />
        {sizeTable.length === 0 ? (
          <p className="text-[12px] text-ink-500">
            No sizes added — the storefront will hide the size-guide section.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500">
                <th className="py-2 pr-3">Size</th>
                <th className="py-2 pr-3">Chest</th>
                <th className="py-2 pr-3">Length</th>
                <th className="py-2 pr-3">Sleeve</th>
                <th className="py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {sizeTable.map((row, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="py-1.5 pr-3">
                    <input
                      type="text"
                      value={row.size}
                      onChange={(e) => updateSize(i, "size", e.target.value)}
                      className={cn(inputClass, "w-20")}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="text"
                      value={row.chest}
                      onChange={(e) => updateSize(i, "chest", e.target.value)}
                      className={cn(inputClass, "w-24")}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="text"
                      value={row.length}
                      onChange={(e) => updateSize(i, "length", e.target.value)}
                      className={cn(inputClass, "w-24")}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="text"
                      value={row.sleeve}
                      onChange={(e) => updateSize(i, "sleeve", e.target.value)}
                      className={cn(inputClass, "w-24")}
                    />
                  </td>
                  <td className="py-1.5">
                    <IconAction
                      onClick={() => {
                        setSizeTable(sizeTable.filter((_, idx) => idx !== i));
                        dirty();
                      }}
                      destructive
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="flex items-center justify-end gap-3">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {saved ? <span className="text-[13px] text-emerald-700">✓ Saved</span> : null}
        <Button
          busy={pending}
          icon={<Save className="h-3.5 w-3.5" />}
          onClick={submit}
        >
          Save content
        </Button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function IconAction({
  onClick,
  disabled,
  destructive,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid place-items-center h-7 w-7 rounded-md border border-ink-200 bg-white transition-colors disabled:opacity-30",
        destructive
          ? "text-red-600 hover:bg-red-50 hover:border-red-200"
          : "text-ink-600 hover:bg-cream-100"
      )}
    >
      {children}
    </button>
  );
}
