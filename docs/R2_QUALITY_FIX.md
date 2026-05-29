# Media quality fix — Cloudflare R2

## What was happening

- **Images on R2 are byte-identical to the local originals in `public.r2-backup/`.**
  Verified with `curl -I` vs `stat -c%s`. The pipeline does no re-encoding
  (no `sharp`, no Polish in code, no Next.js Image Optimizer in use — all
  `<img>` tags are raw).
  Perceived image blur is most likely **browser downscaling** (a 4MB PNG
  forced into a small layout box) or **stale browser cache** holding an
  older lower-quality copy that was uploaded earlier in development.
- **Videos on R2 are much smaller than the originals.** `Magic_Box.mp4`:
  35 MB local vs **2.6 MB on R2** (~13× smaller). The sliders are ~4× smaller.
  This is real quality loss and is fixed by re-uploading transcoded
  high-CRF versions.

## The fix (code side — already done)

1. `scripts/r2-resync.ts` — uploads `public.r2-backup/{images,erp-media,contact-parent.png}`
   to R2 under **versioned keys** `v2/images/...` and `v2/erp-media/...`.
   Versioned keys bypass any cached lower-quality copy at the old keys.
2. `next.config.mjs` redirects updated to point `/images/*` and
   `/erp-media/*` at the new `v2/` keys. Switched from `permanent: true`
   (308) to `permanent: false` (307) during the transition so browsers
   don't pin the URL — flip back to permanent once you're satisfied.
3. `scripts/transcode-videos.sh` — produces H.264 CRF 20 (near-lossless)
   transcodes with `+faststart` and a max height of 1080p, plus a poster
   JPEG. Output goes to `public.r2-backup/v2/images/` so the resync script
   picks them up automatically.
4. `lib/cdn-image.ts` — helper for Cloudflare Image Transformations
   (`/cdn-cgi/image/width=W,quality=Q,format=auto/<url>`). Lets us keep one
   high-quality master in R2 and request right-sized variants per device,
   avoiding the "4MB PNG into a 200px thumbnail" anti-pattern.

## Run order

```bash
# 1. (optional) Transcode the marketing videos. Skip if you're happy with
#    the current sizes of the originals you'd upload as-is.
bash scripts/transcode-videos.sh

# 2. Dry run — see what would be uploaded.
DOTENV=.env.deploy npx tsx scripts/r2-resync.ts

# 3. Apply.
DOTENV=.env.deploy npx tsx scripts/r2-resync.ts --apply

# 4. Verify a few keys land at the new URLs:
curl -sI 'https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/v2/images/quality1.png' | head -10
curl -sI 'https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/v2/images/Magic_Box.mp4'  | head -10

# 5. Deploy the next.config.mjs change.
```

## Manual steps in the Cloudflare dashboard

The following can't be done from the repo — they live in the Cloudflare UI
on the zone fronting R2.

### A. Disable Polish on the media hostname (if enabled)

Cloudflare Polish silently recompresses JPEG/PNG. For a media bucket where
quality matters, turn it OFF (or set to "Lossless" only).

1. Cloudflare dashboard → pick the zone that fronts R2.
2. Speed → Optimization → Image Optimization.
3. **Polish:** Off (or Lossless).
4. **Mirage:** Off.
5. **WebP:** Off if Polish is also off; leave on with Polish=Lossless.

(R2's `pub-*.r2.dev` URL is *not* on your zone — it serves bytes
unchanged. Polish only matters if/when you put R2 behind a custom domain
on your own Cloudflare account.)

### B. Add a custom domain for R2 (recommended)

`pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev` is unstable and gives you no
cache-purge control. Replace it with `media.inventre.in`.

1. R2 → your bucket → Settings → **Public access → Custom Domains → Connect Domain**.
2. Enter `media.inventre.in`. Cloudflare auto-provisions DNS + cert.
3. Once live, update three places:
   - `next.config.mjs` `redirects()` base → `https://media.inventre.in`.
   - `next.config.mjs` `images.remotePatterns` → add the new host.
   - `.env.deploy` `S3_PUBLIC_URL` → `https://media.inventre.in`.
   - `.env.deploy` `NEXT_PUBLIC_MEDIA_CDN_HOST=media.inventre.in` (so
     `lib/cdn-image.ts` starts emitting `/cdn-cgi/image/...` URLs).

### C. Enable Image Transformations

1. Cloudflare dashboard → zone → Speed → Optimization → **Image Resizing**.
2. Toggle **"Resize images from any origin: ON"** (paid feature on Pro+).
3. Once on, `cdnImage("/images/quality1.png", { width: 800, quality: 90 })`
   from `lib/cdn-image.ts` returns transformed variants at the edge.

### D. Purge cache after resync

Even with versioned keys (`v2/`), the *old* `/images/*` paths may sit in
a few caches. Belt-and-braces purge:

1. Cloudflare dashboard → zone → Caching → Configuration → **Purge
   Everything** (or purge specific URLs).
2. Hard-refresh the site (Ctrl+Shift+R) to confirm.

## Long-term: switch hot images to `<Image>` + `cdnImage`

The site currently ships full-resolution PNG/JPEG to every viewport. After
Image Transformations is enabled, migrate the heaviest places first:

- `components/Hero.tsx`
- `components/Categories.tsx`
- `components/about/Innovations.tsx`
- `components/shop/pdp/Gallery.tsx`
- `components/admin/ImageUpload.tsx` (admin preview, lower priority)

Either swap raw `<img>` for `next/image` with `quality={92}`, or stay on
`<img>` and use `cdnImage()`/`cdnImageSrcSet()` for responsive `srcSet`.
Both deliver the same outcome: master stays high-quality in R2; the
browser pulls only the size it actually needs.
