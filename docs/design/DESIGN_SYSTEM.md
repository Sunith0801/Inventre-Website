# Inventre — Design System Spec

Reverse-engineered from the hand-designed homepage, shop, cart and login. Use this as the authoritative reference for redesigning About, Experience Store, and Contact so they feel like the same hand.

---

## 1. Color palette

All colors live in `tailwind.config.ts`. There are exactly **three** color families — keep it that way. No teal, no purple, no slate. Sustainability sections may use a single emerald accent but should not introduce a fourth equal palette.

### Brand (`brand-*`) — warm orange `#E47127`
- `brand-50` `#FEF3EC` — eyebrow pill bg, icon-tile bg, faint chips
- `brand-100` `#FCE2D0` — eyebrow pill border, icon-tile border, hover halo
- `brand-200` `#F9C49F` — quote icons, ordinal numbers (PrincipalsHero "01"), faint markers
- `brand-300` `#F2A26C` — text on dark bg (Innovations eyebrow on `bg-ink-900`)
- `brand-700` `#9A4513` — text inside `bg-brand-50` pills (eyebrow color)
- `brand` (DEFAULT `500`) — primary CTA bg, accent dot, accent SVG stroke, headline highlight word
- `brand-600` — primary CTA hover (`hover:bg-brand-600`)

### Ink (`ink-*`) — neutral text/scaffold `#0A0A0A`
- `ink-900` — headlines, dark surfaces (FinalCTA, Footer, AuthBrandPanel, hero video card)
- `ink-800` — nav links, secondary heads, body bold
- `ink-700` — body copy on cream
- `ink-600` — secondary body
- `ink-500` — captions, meta, "back to home" link
- `ink-400` — muted/empty/placeholder text and quiet labels
- `ink-300` `ink-200` `ink-100` — borders & dividers (200 = strong, 100 = quiet, 300 = focus/disabled)
- `ink-50` — hairline backgrounds rarely used

### Cream (`cream-*`) — page surface
- `cream` (`#FAF7F2`) — page bg (set on `body` in `app/layout.tsx`)
- `cream-50` `#FDFBF8` — softest top of gradient
- `cream-100` — image plate bg behind product photos (ProductCard, hero "What's inside" tiles)
- `cream-200` — alternating-section bg (TheBox, ForSchools, StoreCard, ContactForm), border-y'd

**Light mode only.** The site has no dark mode toggle. Dark surfaces (`bg-ink-900`) are intentional design panels, not theme switches.

**Status colors** (used sparingly): `emerald-50/200/600/700` for success states (newsletter success, "FREE" shipping, copied confirmation). `red-50/200/400/500/700` for form errors. `amber-500` for low-stock product badges only.

---

## 2. Typography

Single typeface: **Plus Jakarta Sans** (loaded via `next/font/google`, exposed as `--font-jakarta`, aliased to both `font-sans` and `font-display` in tailwind). Weights used: 400, 500, 600, 700, 800. Mostly 600/700/800 for display, 400/500 for body.

### Display sizes (from `tailwind.config.ts`)
- `text-display-xl` — `clamp(2.75rem, 6.2vw, 5.5rem)` / lh 1.02 / tracking -0.035em — rare, biggest hero
- `text-display-lg` — `clamp(2rem, 4.5vw, 4rem)` / lh 1.05 / tracking -0.03em — TheBox/FinalCTA
- `text-display-md` — `clamp(1.6rem, 3.2vw, 2.6rem)` / lh 1.1 / tracking -0.025em — section H2s

### Concrete patterns

**Hero H1** (page-top):
```
font-display font-extrabold text-ink-900
style={{ fontSize: "clamp(2rem, 4.4vw, 4rem)", lineHeight: 0.98, letterSpacing: -0.035em }}
```
or as Tailwind: `font-display text-[40px] sm:text-[56px] lg:text-[72px] font-extrabold tracking-tight text-ink-900 leading-[1.02]`.

**Section H2**:
`mt-3 font-display font-extrabold text-display-md text-ink-900` (or the concrete `text-[28px] sm:text-[36px] lg:text-[44px] ... leading-[1.05]`).

**Card H3**:
`font-display text-[18px]` to `text-[22px]` — `font-bold` or `font-extrabold` — `text-ink-900 leading-tight`.

**Body**:
`text-[14px]` to `text-[16px]` `leading-relaxed text-ink-600` (or `text-ink-700` on cream-200 sections for a hair more contrast).

**Eyebrow (text-only variant)**:
`font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand`.

**Eyebrow (PILL variant — preferred for hero & marquee sections)**:
```jsx
<div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
  <span className="h-1.5 w-1.5 rounded-full bg-brand" />
  <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">…</span>
</div>
```

**Big numbers / counters**:
`font-display text-[44px] sm:text-[56px] lg:text-[64px] font-extrabold leading-none tracking-tight text-ink-900`.

**Highlight word** inside H1/H2 wraps in `<span className="text-brand">…</span>`. Apply to **one** key phrase per heading (e.g. "school kit", "rigorously tested", "no queues"). Never to two.

**Squiggle underline** (homepage signature) — when you want to mark the most important phrase in a hero, wrap it in a relative span and stamp an inline SVG path stroke (orange, 3px, rounded). See `Hero.tsx:142-157`. Use on hero only.

**Mono** = Tailwind default (`font-mono`) — for phone numbers, size labels, item counts ("×5"). Never for body.

---

## 3. Spacing & layout rhythm

### Container
Every section uses: `mx-auto max-w-7xl px-5 lg:px-8`. FAQ uses `max-w-4xl`. Forms inside cream sections use `max-w-4xl`.

### Section vertical rhythm
- Standard section: `py-20 lg:py-28`
- Hero (top of page): `pt-12 md:pt-20 pb-16 md:pb-28` or `pt-16 lg:pt-24 pb-14 lg:pb-20`
- Strip section (TrustStrip / Stats / SaleStrip): `py-8` to `py-12 lg:py-16`
- Compact secondary section: `py-12 lg:py-16` or `py-16 lg:py-24`

### Heading-block spacing
After eyebrow: `mt-3` or `mt-4`.
After H2 inside heading-block: `mt-5` or `mt-6` for paragraph.
Between heading-block and grid: `mt-12`.
Between adjacent grid cards: `gap-4 lg:gap-5` (cards), `gap-5 lg:gap-6` (looser), `gap-10 lg:gap-12` for hero L/R columns.

### Section transitions
Alternate between `bg-cream` (the body default) and `bg-cream-200` (with `border-y border-ink-100`). Dark sections (`bg-ink-900`) are punctuation — at most one mid-page (Innovations, FinalCTA), plus the Footer. Don't stack two `bg-cream-200` sections back-to-back; they need the cream default between them to breathe.

---

## 4. Hero / section pattern

### Page heroes — two variants in the original system

**Variant A — split (homepage Hero)**: 12-col grid, `lg:col-span-7` copy + `lg:col-span-5` visual. Visual is a tall (`aspect-[4/5]`) ambient looping video inside `rounded-[28px] border border-ink-200 bg-ink-900 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.35)]`, with a smaller "overlap card" (white, rounded-2xl, border, shadow) tucked into the bottom-left at `-bottom-6 -left-4 sm:-left-6` covering ~60% width.

**Variant B — left-aligned with paired card (AboutHero)**: full-width copy block at top (max-w-4xl), then a 2-col grid below (`lg:grid-cols-[1.2fr_1fr]`) with a white content card on the left and an ambient image card on the right.

Whatever variant, every page hero has, in order:
1. Eyebrow (pill or text — pill is stronger)
2. H1 with one `text-brand` highlight phrase
3. Body (max-w-2xl, `text-[16px] sm:text-[18px] leading-relaxed text-ink-700`)
4. CTA pair OR primary form OR a paired visual asset
5. Trust row (4 stat micro-blocks: `font-display text-[20px] font-bold` value + `text-[13px] text-ink-500` label, `flex flex-wrap gap-x-8 gap-y-3`)

### Hero background recipe (signature)
Stack THREE absolutely-positioned `-z-10` layers:
1. Radial-gradient warm wash (orange glow top-right + orange faint bottom-left + linear cream gradient base)
2. Graph-paper grid: `linear-gradient(rgba(15,15,15,0.12) 1px, transparent 1px)` × 2 axes, `60px 60px`
3. Orange intersection dot: `radial-gradient(circle at 0 0, rgba(228,113,39,0.7) 2px, transparent 2.5px)` `60px 60px`
4. Bottom fade strip (`h-32`) so the grid doesn't clip into the next section

For inner / secondary heroes that should feel quieter, drop the graph-paper and keep ONLY the orange dot grid at `22px 22px`:
```
backgroundImage: "radial-gradient(circle at 1px 1px, rgba(228,113,39,0.18) 1px, transparent 0)"
backgroundSize: "22px 22px"
```

### Section heading block
Two layouts:
- **Left-aligned** (most common): `max-w-2xl` block with eyebrow → H2 → optional caption. Often paired with a right-aligned `View all ↗` text link on the same row using `flex items-end justify-between`.
- **Centered** (Stats, FAQ, PrincipalsHero, VisionMission): `text-center max-w-2xl mx-auto` or `max-w-3xl mx-auto`.

---

## 5. Card patterns

There are exactly four card types. Don't invent a fifth.

### Type 1 — Light feature card (HowItWorks, ProcessTimeline, WhatToExpect, ContactChannels)
```
group relative rounded-2xl border border-ink-100 bg-white p-6 lg:p-7
hover:border-brand hover:shadow-[0_20px_40px_-22px_rgba(228,113,39,0.25)] transition-all
```
Internals: top row of icon-tile + faint big number (right). Below: H3 + body.

**Icon tile** (signature):
```
grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand
group-hover:bg-brand group-hover:text-white transition-all
```
For a 14×14 with corner-dot (HowItWorks): add `relative` and a child `<span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-cream" />`.

**Faint big number** (signature ordinal "01" / "02"):
`font-display text-[36px]` to `text-[48px] font-extrabold leading-none text-brand-50 group-hover:text-brand-100 transition-colors`.

### Type 2 — Image card with bottom info bar (Categories)
```
group relative aspect-[4/5] overflow-hidden rounded-2xl border border-ink-200 bg-cream-100
hover:border-brand transition-colors
```
Inside, layered:
- absolute warm gradient bg (`bg-gradient-to-br from-[#FFE9D4] to-[#FCD5B0]`) — scales `1.05` on hover
- absolute centered product image, `object-contain p-6` — scales `1.10` on hover
- top-left badge pill (white/85 backdrop blur)
- bottom info bar over a `bg-gradient-to-t from-white via-white/90 to-transparent`, with H3 and a small circle CTA button (`grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-white group-hover:bg-brand group-hover:rotate-45`)

### Type 3 — Dark video/portrait card (Hero visual, InTheWild, AuthBrandPanel, PrincipalsHero, Innovations)
```
relative overflow-hidden rounded-2xl (or rounded-[28px] for hero) border border-ink-200 bg-ink-900
```
Layers: media (`absolute inset-0 h-full w-full object-cover` + `transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]`), darkening gradient (`absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/15 to-transparent`), top-left brand chip pill, bottom caption block with eyebrow (white/80) + bold display text.

### Type 4 — Quote / testimonial card (Testimonials)
```
relative rounded-2xl border border-ink-200 bg-white p-7 flex flex-col
```
Has: top-right `<Quote className="h-5 w-5 text-brand-200" />`, self-start eyebrow chip, blockquote, footer (avatar + name + role).

### Avatars
`h-10 w-10 rounded-full bg-gradient-to-br from-brand-200 to-brand-400 grid place-items-center font-display text-[14px] font-bold text-white` with initials fallback.

### Badges (inside cards)
- Tiny uppercase pill (10px): `rounded-full bg-white/85 backdrop-blur border border-white px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-800`
- Brand-filled pill: `rounded-full bg-brand text-white px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase`
- Outline meta-chip: `rounded-full border border-ink-200 px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase text-ink-500`

---

## 6. Buttons & forms

### Primary CTA (orange pill)
```
inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white
px-6 py-4 (or h-11/h-12 px-5) text-[14px] font-semibold (or font-bold)
shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]
hover:bg-brand-600 active:scale-[0.98] transition-all
```
Trailing `<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />` on hover-translating CTAs.

### Secondary CTA (dark pill)
```
inline-flex items-center gap-2 rounded-full bg-ink-900 px-6 py-3.5 text-[14px] font-semibold text-cream
hover:bg-ink-700 transition-colors
```
On dark surfaces flip to: `border border-white/20 bg-white/5 backdrop-blur text-white hover:bg-white/10`.

### Tertiary / ghost
```
inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white text-ink-800
h-10 / h-11 px-4 / px-5 text-[12px] / text-[14px] font-semibold
hover:border-ink-900 transition-colors
```

### Inline link
`text-[14px] font-medium text-ink-700 hover:text-brand transition-colors` or underlined: `underline underline-offset-4`.

### Tiny circle icon button
`grid h-9 w-9 (or h-10 w-10) place-items-center rounded-full text-ink-800 hover:text-brand hover:bg-brand-50 transition-colors`.

### Inputs

**Pill input (hero, search)** — for outward-facing prominent inputs:
```
rounded-full border border-ink-200 bg-white pl-5 pr-12 py-4 text-[15px] font-medium text-ink-900
focus:border-ink-900 focus:outline-none transition-colors
```
With a chevron in the right padding for selects: `<ChevronDown className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500" />`.

**Form input (in-card)** — for forms inside cards:
```
rounded-xl border border-ink-200 bg-white px-3 py-2.5 (or px-4 py-3) text-[14px] (or text-[15px])
text-ink-900 placeholder:text-ink-400 outline-none focus:border-ink-900 transition-colors
```
Errors: swap border to `border-red-400`; below the field add `mt-1.5 text-[12px] font-medium text-red-500`.
Form-wide error banner: `rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700`.

**Compound input** (input + button glued, e.g. newsletter, coupon): `flex items-stretch rounded-full border bg-white overflow-hidden focus-within:border-brand` (or `focus-within:border-ink-900`).

**Field label**: `text-[12px] font-semibold text-ink-700` with `<span className="text-brand">*</span>` for required.

### Pill tab group (ContactForm — keep this)
```
inline-flex rounded-full border border-ink-200 bg-white p-1
<button className="inline-flex items-center gap-1.5 rounded-full px-4 h-9 text-[13px] font-semibold transition-all
  + active:bg-ink-900 text-white | inactive:text-ink-600 hover:text-ink-900">
```

---

## 7. Decorative motifs (signatures)

These are what make the site feel hand-built. Use them.

1. **Graph-paper hero background + orange intersection dots** — homepage Hero only. Powerful, don't dilute.
2. **Quiet orange dot-grid** — secondary backgrounds (`22px 22px`, opacity 0.18). Used in TheBox, AboutHero, ContactHero.
3. **Radial warm wash** — `radial-gradient(60% 50% at X% Y%, rgba(228,113,39,0.10–0.30), transparent 65%)`. Always orange-on-cream or orange-on-ink. Never pink, never blue.
4. **Squiggle underline** under a hero phrase — see Hero.tsx (curved SVG path, stroke `#E47127`, width 3, linecap round). Use **once** per page max.
5. **Mosaic grid** — `grid lg:grid-cols-3 lg:auto-rows-[260px]` with one `lg:col-span-2 lg:row-span-2` and two singles (InTheWild). Reach for this when you have heterogeneous media.
6. **Overlap card** — a smaller white rounded-2xl card sticking out from `-bottom-6 -left-4` of a tall image card. Extra dimension. Used in Hero, ForSchools (stat tile).
7. **Dashed orange connector line** between sequential cards (HowItWorks):
   ```
   absolute left-[14%] right-[14%] top-14 h-px
   backgroundImage: "linear-gradient(to right, #E47127 50%, transparent 50%)"
   backgroundSize: "12px 1px"  opacity: 0.4
   ```
8. **Animated marquee** — used in TrustStrip and SaleStrip. Already configured: `animate-marquee` (40s linear infinite).
9. **Scroll-driven motion** — TheBox lid opens via `useScroll` + `useTransform`. Use sparingly — once per page is plenty.
10. **Framer entry curve** — every reveal uses `transition={{ duration: 0.5–0.7, ease: [0.16, 1, 0.3, 1] }}`. Stagger via `delay: i * 0.06–0.12`. `viewport={{ once: true, margin: "-80px" }}`. Initial `{ opacity: 0, y: 20–24 }`. **Always.**
11. **Iconography** — `lucide-react`, `strokeWidth={2}`, sized `h-3.5 w-3.5` (inline meta), `h-4 w-4` (button glyph), `h-5 w-5` (icon tile interior), `h-6 w-6` (large tile). Wrap in the brand-50 / brand pill tile.
12. **Trailing arrow translate** — on hover-able CTAs: `transition-transform group-hover:translate-x-0.5`.
13. **Rotating CTA chip** on category cards — `group-hover:rotate-45` on the `bg-ink-900` arrow circle.

---

## 8. Section-transition strips

- **SaleStrip** — top-of-page: solid `bg-brand text-white`, marquee, `text-[12px] font-bold tracking-[0.22em]`. Pipe separators with `opacity-70`. Page-only, never mid-page.
- **TrustStrip** — `border-y border-ink-100 bg-cream`, "Trusted by" label + horizontal marquee of school names in `font-display text-[14px] font-semibold tracking-[0.18em] text-ink-400 hover:text-ink-700`. Mask gradient on the rail edges.
- **Stats** — `border-y border-ink-100 bg-cream`, 4-col counter grid with animated number-rolling. Use this between major narrative sections.
- **Divider line** inside cards — `border-t border-ink-100` (or `pt-3 border-t border-ink-100` inside a dl).

---

## 9. Imagery & icons

**Photography style.** Clean, editorial, warm-toned. Real classrooms, kids in uniform, on cream/neutral floors. No stock-photo people in business suits. The site uses `/images/...` paths served from `public/images/` (mirrored from the legacy `inventre.in` host) — when in doubt, reuse existing assets (parent.png, school.png, business.png, design-img.png, sustain-img.png, slider_1/2/3.mp4, Magic_Box.mp4).

**Product imagery.** Always center-crop `object-contain p-4` to `p-6` on a `bg-cream-100` plate. Never `object-cover` for product photography — it crops the silhouette.

**Icons.** lucide-react only. Strokes 2. Mounted inside the brand-50 rounded-2xl tile, or as 3.5/4 inline glyphs inside meta rows. Don't fill icons with brand color outside the tile — always orange-stroke.

**Video.** Ambient looping (`autoPlay muted loop playsInline`) inside `bg-ink-900` cards with a darkening gradient on top. Caption uses uppercase eyebrow + display text in white.

---

## 10. Tone of voice

- **Short, declarative sentences.** "Your child's entire school kit. One box. Delivered." Not "Welcome to the Inventre platform where parents can…".
- **Use periods like punctuation in the headline.** "Three steps. No phone calls. No queues." Periods inside the `<h2>`. It's a signature.
- **Confident, not corporate.** "We treat your crest like our own." not "We strive to deliver brand-consistent experiences."
- **Concrete proof.** Always include a number (40+ schools, 20K+ students, 4.8★). Never say "many" or "lots".
- **Address the reader directly.** "Your child", "your school", "your kit".
- **Light wink ok in eyebrows.** "Inventre, in the wild", "Words from principals", "Ready when you are". No emoji except 🇮🇳 in the © line.
- Sentence case in eyebrows (the visual ALL CAPS comes from `uppercase` + tracking, not from the source string).

---

## 11. Reusable JSX snippets

```tsx
// Section wrapper — alternating cream
<section className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">…</section>

// Section wrapper — cream-200 banded
<section className="bg-cream-200 border-y border-ink-100">
  <div className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">…</div>
</section>

// Section wrapper — dark
<section className="bg-ink-900 text-white relative overflow-hidden">
  <div aria-hidden className="absolute inset-0 opacity-[0.05]" style={{
    backgroundImage:"linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
    backgroundSize:"32px 32px",
  }} />
  <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">…</div>
</section>

// Eyebrow pill
<div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
  <span className="h-1.5 w-1.5 rounded-full bg-brand" />
  <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
    Eyebrow text
  </span>
</div>

// Headline block
<div className="max-w-2xl">
  {/* eyebrow pill */}
  <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900">
    Real schools. Real kids. <span className="text-brand">Real first-day pride.</span>
  </h2>
  <p className="mt-5 max-w-md text-[15px] sm:text-[16px] leading-relaxed text-ink-600">…</p>
</div>

// Light feature card
<motion.div
  initial={{ opacity: 0, y: 24 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, margin: "-80px" }}
  transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
  className="group relative rounded-2xl border border-ink-100 bg-white p-7 hover:border-brand hover:shadow-[0_20px_40px_-20px_rgba(228,113,39,0.25)] transition-all"
>
  <div className="flex items-center justify-between">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand transition-all group-hover:bg-brand group-hover:text-white">
      <Icon className="h-5 w-5" strokeWidth={2} />
    </span>
    <span className="font-display text-[48px] font-extrabold text-brand-50 leading-none group-hover:text-brand-100 transition-colors">
      01
    </span>
  </div>
  <h3 className="mt-6 font-display text-[22px] font-bold text-ink-900">{title}</h3>
  <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{body}</p>
</motion.div>

// Primary CTA
<a className="group inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-4 text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 active:scale-[0.98] transition-all">
  Find my school <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
</a>

// Secondary (dark) CTA
<a className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-6 py-3.5 text-[14px] font-semibold text-cream hover:bg-ink-700 transition-colors">
  Partner with us <ArrowRight className="h-4 w-4" />
</a>

// Inline stat block (4-up trust row)
<div className="flex flex-wrap gap-x-8 gap-y-3">
  {trust.map((t) => (
    <div key={t.v} className="flex items-baseline gap-2">
      <span className="font-display text-[20px] font-bold text-ink-900">{t.k}</span>
      <span className="text-[13px] text-ink-500">{t.v}</span>
    </div>
  ))}
</div>

// Big counter stat (Stats / AuthBrandPanel)
<div>
  <p className="font-display text-[44px] sm:text-[56px] lg:text-[64px] font-extrabold leading-none tracking-tight text-ink-900">
    20,000+
  </p>
  <p className="mt-2 text-[13px] font-medium text-ink-500">Happy students</p>
</div>

// Hero background stack (graph paper variant)
<div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
  background: "radial-gradient(70% 55% at 85% 10%, rgba(228,113,39,0.22), transparent 65%), radial-gradient(60% 50% at 0% 100%, rgba(228,113,39,0.12), transparent 65%), linear-gradient(180deg, #FFF6EC 0%, #FAF7F2 60%)",
}} />
<div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
  backgroundImage: "linear-gradient(rgba(15,15,15,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(15,15,15,0.12) 1px, transparent 1px)",
  backgroundSize: "60px 60px",
}} />
<div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{
  backgroundImage: "radial-gradient(circle at 0 0, rgba(228,113,39,0.7) 2px, transparent 2.5px)",
  backgroundSize: "60px 60px",
}} />
<div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 -z-10"
  style={{ background: "linear-gradient(180deg, rgba(250,247,242,0), rgba(250,247,242,1))" }} />
```

---

## 12. What to AVOID — divergences in current About / Experience / Contact

These are the patterns the AI-generated pages reach for that **don't** match the original system. Fix these on the redesign.

1. **Bare-text eyebrows on heroes.** AboutHero, ContactPage and WhatToExpect use `<p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">`. The originals use the **pill** variant (with the orange dot and `bg-brand-50 border border-brand-100`) on every hero. Switch to the pill on hero. Keep bare-text only inside small section headers where the eyebrow is repeated.

2. **Hero has copy but no paired visual asset.** AboutHero and ExperienceHero are essentially text blocks on a dot grid. The signature homepage Hero pairs copy with a tall ambient video card + overlap card. About and Experience need at least an ambient `bg-ink-900` rounded-2xl video/image card on the right side or an overlap card. ContactPage has no visual at all — give it the split layout with a paired image (parent/school/business stack collage).

3. **No squiggle underline on hero highlight.** "simple idea." in AboutHero and "remarkable." in ContactPage are flat orange spans. Wrap one of them in the SVG curve from `Hero.tsx:142-157`.

4. **No trust row under hero.** The homepage hero closes with the 4-stat inline row. About / Experience / Contact heroes drop straight into the next section. Add a 3- or 4-stat trust row.

5. **No graph-paper grid on hero.** Heroes use only the soft 22px dot grid — that's the *secondary* variant. The flagship pages (especially About) deserve the full graph-paper + intersection-dot stack.

6. **ProcessTimeline is a flat 7-card grid.** No dashed orange connector line, no progressive flow indication. Add the dashed connector pattern from HowItWorks (or a vertical timeline rail with numbered orange nodes for the 7-step format).

7. **Innovations cards have a small icon below the image** instead of the icon-tile-on-top pattern shared by every other card. Move the icon tile above the title and give it the brand-50 / border-brand-100 treatment used elsewhere on `bg-ink-900` (white/10 backdrop-blur instead of brand-50).

8. **VisionMission's "Mission" card uses `bg-brand` solid orange.** That's loud and breaks the cream-on-white card rhythm. Either keep Vision white and Mission `bg-ink-900` (matches the rest of the dark-card system) **or** keep both white and use the orange on icons only. Avoid full-orange card backgrounds — they're not in the original lexicon.

9. **Sustainability uses an emerald palette as a third primary color.** The original system has only orange + ink + cream. Demote emerald to badge-only (the small leaf chip), keep the section's H2 and "the world they grow into" highlight in `text-brand` for visual continuity. Or: keep emerald only where it appears as a true success state, not as a section accent.

10. **ContactForm tabs and form sit on flat `bg-cream-200` with no eyebrow pill.** Add the pill, and move the form inside a properly elevated card (`rounded-2xl border border-ink-100 bg-white`) — which it already partly is, but the section heading needs the pill.

11. **ContactChannels cards use a `bg-cream-100 aspect-[5/3]` plate with a centered illustration.** That's fine, but the icon is overlapping the top-left as a `bg-brand text-white` circle, which fights with the brand-50 tile system. Switch to the standard tile (`bg-brand-50 border border-brand-100 text-brand`) for consistency.

12. **No "View all ↗" pattern on multi-card sections.** Categories has it; About's Innovations / Process should too where appropriate.

13. **No mosaic / overlap-card layouts.** Both Experience and About are 100% straight grids. At least one section per page should use either the 1-large-2-small mosaic, or the overlap-card pattern, to break monotony.

14. **`rounded-xl` everywhere on the address card buttons** instead of the `rounded-full` pill pattern. StoreCard's "Open in Maps" button is `rounded-full` ✅ but make sure all internal CTAs follow.

15. **Headlines often promote two `text-brand` phrases.** VisionMission's H2 has "Tomorrow, we set the benchmark." which is good — but elsewhere the emphasis is overused. One brand-highlight phrase per heading. Pick the punchline.

16. **Ambient looping videos missing on About & Experience.** The system loves video (Hero, InTheWild, ForSchools, Innovations). About's hero card uses a static image. Replace with `Magic_Box.mp4` or `slider_1.mp4` for life.

17. **Body color leans `text-ink-700`** when the rest of the site uses `text-ink-600` on cream. Lighten back to `text-ink-600` for visual harmony.

18. **The framer reveal uses `animate=` instead of `whileInView=` on hero blocks.** That's fine on hero (above-the-fold), but the secondary About cards correctly use `whileInView`. Keep that distinction — never put `whileInView` on hero copy.

---

**Use the snippets in §11 verbatim.** When in doubt, look at `Hero.tsx`, `HowItWorks.tsx`, `ForSchools.tsx`, `PrincipalsHero.tsx`, `InTheWild.tsx`, and `FinalCTA.tsx` — those six components contain every pattern this site needs.
