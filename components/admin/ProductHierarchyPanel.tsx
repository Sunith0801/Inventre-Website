"use client";

/**
 * BOM-hierarchy + variant-attribute panel for the admin product detail page.
 * Surfaces fields that the BOM/Item.csv backfills populate, with edit-in-place
 * for the structured ones and a read-only matrix view of attribute_groups
 * (same shape the shop PDP renders).
 */

import { useState } from "react";
import { Save, AlertCircle } from "lucide-react";
import { Button, Badge } from "@/components/admin/ui/primitives";

type Group = { name: string; values: string[] };

type Props = {
  productId: string;
  initial: {
    bundleLevel: "magic_box" | "bookkit" | "sub_bundle" | "leaf" | null;
    bundleGender: "Boys" | "Girls" | null;
    isVariantItem: boolean;
    variantOfProductId: string | null;
    variantOfName: string | null;
    variantAttribute: string | null;
    variantAttributeValue: string | null;
    attributeGroups: Group[];
    templateVariants: { id: string; name: string }[];
  };
};

export function ProductHierarchyPanel({ productId, initial }: Props) {
  const [bundleLevel, setBundleLevel] = useState(initial.bundleLevel ?? "");
  const [bundleGender, setBundleGender] = useState(initial.bundleGender ?? "");
  const [isVariantItem, setIsVariantItem] = useState(initial.isVariantItem);
  const [variantAttribute, setVariantAttribute] = useState(
    initial.variantAttribute ?? ""
  );
  const [variantAttributeValue, setVariantAttributeValue] = useState(
    initial.variantAttributeValue ?? ""
  );
  const [groups, setGroups] = useState<Group[]>(initial.attributeGroups ?? []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundleLevel: bundleLevel || null,
          bundleGender: bundleGender || null,
          isVariantItem,
          variantAttribute: variantAttribute || null,
          variantAttributeValue: variantAttributeValue || null,
          attributeGroups: groups.length > 0 ? groups : null,
        }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 200));
      setSavedAt(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function updateGroupValues(idx: number, newValues: string) {
    const next = [...groups];
    next[idx] = {
      ...next[idx],
      values: newValues
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    setGroups(next);
  }
  function updateGroupName(idx: number, name: string) {
    const next = [...groups];
    next[idx] = { ...next[idx], name };
    setGroups(next);
  }
  function addGroup() {
    setGroups([...groups, { name: "New Group", values: [] }]);
  }
  function removeGroup(idx: number) {
    setGroups(groups.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <div className="px-5 py-4 border-b border-ink-100">
        <h3 className="font-display text-[15px] font-bold text-ink-900">
          BOM Hierarchy & Variant Attributes
        </h3>
        <p className="mt-0.5 text-[12px] text-ink-500">
          Derived from BOM.csv + Item.csv. Editable — shop catalog filters use these.
        </p>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bundle Level">
            <select
              value={bundleLevel}
              onChange={(e) => setBundleLevel(e.target.value as typeof bundleLevel)}
              className="form-select w-full"
            >
              <option value="">— unset —</option>
              <option value="magic_box">Magic Box (root)</option>
              <option value="bookkit">Bookkit (intermediate)</option>
              <option value="sub_bundle">Sub-bundle (intermediate)</option>
              <option value="leaf">Leaf (purchasable)</option>
            </select>
          </Field>
          <Field label="Bundle Gender (Magic Box only)">
            <select
              value={bundleGender}
              onChange={(e) =>
                setBundleGender(e.target.value as typeof bundleGender)
              }
              className="form-select w-full"
            >
              <option value="">— unisex —</option>
              <option value="Boys">Boys</option>
              <option value="Girls">Girls</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="inline-flex items-center gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox"
              checked={isVariantItem}
              onChange={(e) => setIsVariantItem(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300 accent-brand"
            />
            Is variant item (hidden from shop)
          </label>
          <div className="text-[12px] text-ink-500">
            {initial.variantOfProductId ? (
              <>
                Variant of:{" "}
                <a
                  href={`/admin/products/${initial.variantOfProductId}`}
                  className="text-brand-700 hover:underline font-mono"
                >
                  {initial.variantOfName ?? initial.variantOfProductId}
                </a>
              </>
            ) : (
              <span>Not linked to a template</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Variant Attribute (for variant rows)">
            <input
              type="text"
              value={variantAttribute}
              onChange={(e) => setVariantAttribute(e.target.value)}
              placeholder="e.g. Winmore Whitefield Grade 6 Language Selection"
              className="form-input w-full"
            />
          </Field>
          <Field label="Variant Attribute Value">
            <input
              type="text"
              value={variantAttributeValue}
              onChange={(e) => setVariantAttributeValue(e.target.value)}
              placeholder="e.g. Winmore Whitefield Grade 6 Hindi 2nd Lan"
              className="form-input w-full"
            />
          </Field>
        </div>

        {initial.templateVariants.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-2">
              Template Variants ({initial.templateVariants.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {initial.templateVariants.map((v) => (
                <a
                  key={v.id}
                  href={`/admin/products/${v.id}`}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-ink-200 bg-cream-50 hover:border-ink-400 text-ink-800"
                >
                  {v.name}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-ink-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
              Attribute Groups (shop PDP pickers)
            </p>
            <button
              type="button"
              onClick={addGroup}
              className="text-[12px] text-brand-700 hover:text-brand-900 font-medium"
            >
              + Add group
            </button>
          </div>
          {groups.length === 0 ? (
            <p className="text-[12px] text-ink-500 italic">
              No attribute groups. The shop PDP will fall back to the single
              size picker.
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_2fr_auto] gap-3 items-start"
                >
                  <input
                    type="text"
                    value={g.name}
                    onChange={(e) => updateGroupName(i, e.target.value)}
                    placeholder="Group name (e.g. Uniform Colors)"
                    className="form-input w-full text-[13px]"
                  />
                  <input
                    type="text"
                    value={g.values.join(", ")}
                    onChange={(e) => updateGroupValues(i, e.target.value)}
                    placeholder="Comma-separated values (e.g. Red, Green, Blue)"
                    className="form-input w-full text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => removeGroup(i)}
                    className="text-[12px] text-red-600 hover:text-red-800 px-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {groups.length > 0 && (
            <div className="mt-4 rounded-lg bg-cream-50 border border-ink-100 p-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-2">
                Preview (as shop PDP renders)
              </p>
              {groups.map((g, i) => (
                <div key={i} className="mb-2 last:mb-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-900">
                    {g.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {g.values.map((v) => (
                      <Badge key={v} tone="default" size="sm">
                        {v}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-ink-100">
          <div className="text-[12px]">
            {error ? (
              <span className="text-red-700 inline-flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </span>
            ) : savedAt ? (
              <span className="text-emerald-700">Saved.</span>
            ) : (
              <span className="text-ink-500">
                Edits override BOM/Item.csv-derived values.
              </span>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            disabled={saving}
            icon={<Save className="h-3.5 w-3.5" />}
          >
            {saving ? "Saving…" : "Save hierarchy"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
