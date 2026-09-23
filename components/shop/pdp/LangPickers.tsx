"use client";

/**
 * Bookkit language choosers, extracted from app/shop/[id]/page.tsx on
 * 2026-09-23 (F-08). Two shapes exist in the catalogue:
 *   - KitLangPicker: one product VARIANT per language ("…Bookkit Hindi 2nd
 *     Lan Tel 3rd Lan"), the parent picks a variant slug;
 *   - TemplateLangPicker: one product with a language ATTRIBUTE, the parent
 *     picks a (2nd, 3rd) pair resolved to a variant id.
 * Both render LangCard tiles and a LangSummary strip in the language's colour.
 */
import { motion, AnimatePresence } from "framer-motion";
import { parseKitLang, parseKitThirdLang, type LangPair } from "@/lib/bookkit-langs";

const LANG_COLORS: Record<string, { bg: string; ring: string; text: string; gradient: string }> = {
  Hindi:   { bg: "bg-orange-50",  ring: "ring-orange-400",  text: "text-orange-700", gradient: "bg-gradient-to-br from-orange-100 via-orange-200 to-orange-300" },
  Telugu:  { bg: "bg-teal-50",    ring: "ring-teal-400",    text: "text-teal-700",   gradient: "bg-gradient-to-br from-teal-100 via-teal-200 to-teal-300" },
  French:  { bg: "bg-blue-50",    ring: "ring-blue-400",    text: "text-blue-700",   gradient: "bg-gradient-to-br from-blue-100 via-blue-200 to-blue-300" },
  Kannada: { bg: "bg-yellow-50",  ring: "ring-yellow-400",  text: "text-yellow-700", gradient: "bg-gradient-to-br from-yellow-100 via-yellow-200 to-yellow-300" },
  Sanskrit:{ bg: "bg-purple-50",  ring: "ring-purple-400",  text: "text-purple-700", gradient: "bg-gradient-to-br from-purple-100 via-purple-200 to-purple-300" },
  Marathi: { bg: "bg-rose-50",    ring: "ring-rose-400",    text: "text-rose-700",   gradient: "bg-gradient-to-br from-rose-100 via-rose-200 to-rose-300" },
  Tamil:   { bg: "bg-emerald-50", ring: "ring-emerald-400", text: "text-emerald-700",gradient: "bg-gradient-to-br from-emerald-100 via-emerald-200 to-emerald-300" },
  English: { bg: "bg-sky-50",     ring: "ring-sky-400",     text: "text-sky-700",    gradient: "bg-gradient-to-br from-sky-100 via-sky-200 to-sky-300" },
  _default:{ bg: "bg-cream-100",  ring: "ring-ink-400",     text: "text-ink-700",    gradient: "bg-gradient-to-br from-cream-100 via-cream-200 to-cream-300" },
};

function LangCard({
  lang,
  subtitle,
  price,
  active,
  onClick,
}: {
  lang: string;
  subtitle?: string;
  price?: number;
  active: boolean;
  onClick: () => void;
}) {
  const col = LANG_COLORS[lang] ?? LANG_COLORS._default;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      whileTap={{ scale: 0.97 }}
      animate={active ? { scale: 1.02 } : { scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={[
        "relative flex flex-col items-center justify-center gap-1 rounded-2xl cursor-pointer select-none transition-all duration-200",
        "border-2",
        active
          ? `${col.gradient} ${col.ring.replace("ring-", "border-")} ${col.text} shadow-lg px-8 py-5 min-w-[130px]`
          : `bg-white border-ink-100 text-ink-700 hover:border-ink-300 px-5 py-4 min-w-[96px]`,
      ].join(" ")}
    >
      {active && (
        <motion.span
          layoutId="lang-active-dot"
          className={`absolute top-2 right-2.5 h-2.5 w-2.5 rounded-full ${col.ring.replace("ring-", "bg-")}`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        />
      )}
      <span className={`text-[10px] font-bold uppercase tracking-[0.16em] opacity-70 ${active ? col.text : "text-ink-400"}`}>
        2nd Language
      </span>
      <span className={`font-display tracking-tight leading-tight ${active ? "text-[20px] font-extrabold" : "text-[17px] font-bold"}`}>
        {lang}
      </span>
      {subtitle && (
        <span className={`text-[10px] font-semibold mt-0.5 ${active ? col.text : "text-ink-400"}`}>
          {subtitle}
        </span>
      )}
      {price != null && price > 0 && (
        <span className={`font-bold mt-0.5 ${active ? "text-[14px]" : "text-[12px] text-ink-500"}`}>
          ₹{price.toLocaleString("en-IN")}
        </span>
      )}
    </motion.button>
  );
}

function LangSummary({ secondLang, thirdLang, color }: { secondLang: string; thirdLang?: string; color: { bg: string; text: string; ring: string; gradient: string } }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mt-3 mb-1 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${color.gradient} ${color.ring.replace("ring-", "border-")}`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-bold uppercase tracking-widest opacity-70 ${color.text}`}>2nd Language</span>
        <span className={`text-[16px] font-extrabold font-display ${color.text}`}>{secondLang}</span>
      </div>
      {thirdLang && (
        <>
          <span className="text-ink-300">·</span>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold uppercase tracking-widest opacity-70 ${color.text}`}>3rd Language (auto)</span>
            <span className={`text-[16px] font-extrabold font-display ${color.text}`}>{thirdLang}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

export function KitLangPicker({
  variants,
  activeSlug,
  onPick,
}: {
  variants: { id: string; name: string; slug: string; price?: number; img?: string | null }[];
  activeSlug: string;
  onPick: (slug: string) => void;
}) {
  const activeVariant = variants.find((v) => v.slug === activeSlug);
  const activeLang = activeVariant ? (parseKitLang(activeVariant.name) ?? activeVariant.name) : null;
  const activeThird = activeVariant ? parseKitThirdLang(activeVariant.name) : null;
  const col = activeLang ? (LANG_COLORS[activeLang] ?? LANG_COLORS._default) : LANG_COLORS._default;

  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-3">
        Select 2nd Language
      </p>
      <div className="flex flex-wrap gap-3">
        {variants.map((v) => {
          const lang = parseKitLang(v.name) ?? v.name;
          const third = parseKitThirdLang(v.name);
          return (
            <LangCard
              key={v.id}
              lang={lang}
              subtitle={third ? `3rd: ${third}` : undefined}
              price={v.price}
              active={v.slug === activeSlug}
              onClick={() => onPick(v.slug)}
            />
          );
        })}
      </div>
      <AnimatePresence>
        {activeLang && (
          <LangSummary
            key={activeLang}
            secondLang={activeLang}
            thirdLang={activeThird ?? undefined}
            color={col}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function TemplateLangPicker({
  pairs,
  selected,
  onPick,
}: {
  pairs: LangPair[];
  selected: LangPair | null;
  onPick: (pair: LangPair) => void;
}) {
  const secondLangs = [...new Set(pairs.map((p) => p.secondLang))];
  const col = selected ? (LANG_COLORS[selected.secondLang] ?? LANG_COLORS._default) : LANG_COLORS._default;

  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-3">
        Select 2nd Language
      </p>
      <div className="flex flex-wrap gap-3">
        {secondLangs.map((lang) => {
          const pair = pairs.find((p) => p.secondLang === lang)!;
          return (
            <LangCard
              key={lang}
              lang={lang}
              price={pair.price > 0 ? pair.price : undefined}
              active={selected?.variantId === pair.variantId}
              onClick={() => onPick(pair)}
            />
          );
        })}
      </div>
      <AnimatePresence>
        {selected && (
          <LangSummary
            key={selected.variantId}
            secondLang={selected.secondLang}
            thirdLang={selected.thirdLang || undefined}
            color={col}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
