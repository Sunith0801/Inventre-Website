"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2 } from "lucide-react";

export function ImageUpload({
  label,
  value,
  onChange,
  folder = "uploads",
  className = "",
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  className?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Upload failed");
      }
      const data = await res.json();
      onChange(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={"flex flex-col " + className}>
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <div className="mt-1.5 rounded-xl border border-ink-200 bg-white overflow-hidden">
        {value ? (
          <div className="flex items-center gap-3 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              className="h-14 w-14 rounded-lg object-cover bg-cream-100 border border-ink-100"
            />
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 min-w-0 text-[12px] font-mono text-ink-700 bg-transparent outline-none"
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Remove image"
              className="grid h-8 w-8 place-items-center rounded-full text-ink-500 hover:text-red-500 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 py-4 text-[13px] font-semibold text-ink-700 hover:text-brand transition-colors"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Upload image
              </>
            )}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="mt-1.5 text-[12px] text-red-600">{error}</p>
      )}
    </div>
  );
}
