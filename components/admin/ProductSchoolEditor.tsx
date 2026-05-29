"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, X } from "lucide-react";

type Row = {
  id: string;
  name: string;
  slug: string;
  status: string;
  assigned: boolean;
  overridePrice: number | null;
  overrideMrp: number | null;
  isRequired: boolean;
  customImageUrl: string | null;
};

export function ProductSchoolEditor({
  productId,
  basePriceRupees,
  schools,
}: {
  productId: string;
  basePriceRupees: number;
  schools: Row[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(schools);
  const [pending, start] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);

  const upsert = (id: string, patch: Partial<Row>) =>
    setRows(
      rows.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        // Un-assigning clears the per-school overrides so a future re-assign
        // doesn't silently resurrect a stale image / price the admin forgot.
        if (patch.assigned === false) {
          next.customImageUrl = null;
          next.overridePrice = null;
          next.overrideMrp = null;
          next.isRequired = false;
        }
        return next;
      })
    );

  const save = (r: Row) => {
    setSavingId(r.id);
    start(async () => {
      await fetch(`/api/admin/products/${productId}/schools/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigned: r.assigned,
          overridePrice: r.overridePrice,
          overrideMrp: r.overrideMrp,
          isRequired: r.isRequired,
          customImageUrl: r.customImageUrl,
        }),
      });
      setSavingId(null);
      router.refresh();
    });
  };

  const uploadImage = async (rowId: string, file: File) => {
    setUploadingId(rowId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", `products/${productId}/schools/${rowId}`);
      const up = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!up.ok) throw new Error("Upload failed");
      const { url } = await up.json();
      upsert(rowId, { customImageUrl: url });
    } catch {
      // swallow — surface in row UI later
    } finally {
      setUploadingId(null);
    }
  };

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <div className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500 bg-cream-100">
            <th className="px-4 py-3 w-10"></th>
            <th className="px-4 py-3">School</th>
            <th className="px-4 py-3">Override price (₹)</th>
            <th className="px-4 py-3">Override MRP (₹)</th>
            <th className="px-4 py-3 text-center">Required</th>
            <th className="px-4 py-3">School image</th>
            <th className="px-4 py-3 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-ink-100">
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={r.assigned}
                  onChange={(e) => upsert(r.id, { assigned: e.target.checked })}
                  className="h-4 w-4 accent-brand"
                />
              </td>
              <td className="px-4 py-2">
                <p className="font-semibold text-ink-900">{r.name}</p>
                <p className="text-[11px] font-mono text-ink-500">{r.slug}</p>
              </td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  min={0}
                  placeholder={String(basePriceRupees)}
                  value={r.overridePrice ?? ""}
                  onChange={(e) =>
                    upsert(r.id, {
                      overridePrice:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  disabled={!r.assigned}
                  className="w-24 rounded-md border border-ink-200 px-2 py-1 text-[13px] tabular-nums outline-none focus:border-ink-900 disabled:bg-cream-100"
                />
              </td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  min={0}
                  placeholder="—"
                  value={r.overrideMrp ?? ""}
                  onChange={(e) =>
                    upsert(r.id, {
                      overrideMrp:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  disabled={!r.assigned}
                  className="w-24 rounded-md border border-ink-200 px-2 py-1 text-[13px] tabular-nums outline-none focus:border-ink-900 disabled:bg-cream-100"
                />
              </td>
              <td className="px-4 py-2 text-center">
                <input
                  type="checkbox"
                  checked={r.isRequired}
                  onChange={(e) =>
                    upsert(r.id, { isRequired: e.target.checked })
                  }
                  disabled={!r.assigned}
                  className="h-4 w-4 accent-brand disabled:opacity-50"
                />
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {r.customImageUrl ? (
                    <div className="relative h-9 w-9 rounded-md overflow-hidden border border-ink-200 bg-cream-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.customImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => upsert(r.id, { customImageUrl: null })}
                        disabled={!r.assigned}
                        title="Remove school image"
                        className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:opacity-40"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ) : null}
                  <input
                    ref={(el) => {
                      fileInputs.current[r.id] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(r.id, f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputs.current[r.id]?.click()}
                    disabled={!r.assigned || uploadingId === r.id}
                    className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 h-7 text-[11px] font-medium text-ink-700 hover:bg-cream-50 disabled:opacity-40"
                  >
                    {uploadingId === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    {r.customImageUrl ? "Replace" : "Upload"}
                  </button>
                </div>
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => save(r)}
                  disabled={pending && savingId === r.id}
                  className="rounded-full bg-brand text-white px-3 h-8 text-[11px] font-bold hover:bg-brand-600 disabled:opacity-60"
                >
                  {pending && savingId === r.id ? "Saving…" : "Save"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
