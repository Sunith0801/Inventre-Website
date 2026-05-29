#!/usr/bin/env bash
# Transcode hero/marketing videos for the web.
#
# The originals (e.g. Magic_Box.mp4 at ~34MB) are bigger than they need to
# be for the web, and the previously-uploaded R2 copies are over-compressed
# (~2.6MB) to the point of visible quality loss. This script produces a
# middle-ground encode: H.264 CRF 20 (visually near-lossless for web
# playback), faststart-flagged for instant playback, and stripped of any
# editor metadata. We also emit a poster JPEG (first frame, q=2 = max
# quality) so <video poster=...> is sharp.
#
# Output goes to public.r2-backup/v2/ so scripts/r2-resync.ts picks it up.
#
# Usage:
#   bash scripts/transcode-videos.sh             # transcode all videos in source
#   bash scripts/transcode-videos.sh Magic_Box   # one file (basename, no .mp4)
#
# Requires: ffmpeg (apt install ffmpeg).

set -euo pipefail

SRC_DIR="${SRC_DIR:-public.r2-backup/images}"
OUT_DIR="${OUT_DIR:-public.r2-backup/v2/images}"

# CRF: 18=visually lossless, 20=near-lossless (default), 23=good web quality.
# Lower = bigger file, higher quality. 20 is the sweet spot for marketing video.
CRF="${CRF:-20}"
# preset: slower = better compression at same quality. 'slow' is fine on a build host.
PRESET="${PRESET:-slow}"
# Cap height to 1080 so 4K masters don't ship as 4K. Comment out to keep original.
MAX_HEIGHT="${MAX_HEIGHT:-1080}"

mkdir -p "$OUT_DIR"

shopt -s nullglob
if [[ $# -gt 0 ]]; then
  FILES=("$SRC_DIR/$1.mp4" "$SRC_DIR/$1.mov" "$SRC_DIR/$1.webm")
else
  FILES=("$SRC_DIR"/*.mp4 "$SRC_DIR"/*.mov "$SRC_DIR"/*.webm)
fi

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  name="${base%.*}"
  out="$OUT_DIR/${name}.mp4"
  poster="$OUT_DIR/${name}.poster.jpg"

  if [[ -f "$out" && "$out" -nt "$f" ]]; then
    echo "  [skip] $base (already transcoded, newer than source)"
    continue
  fi

  echo "  [enc]  $base  ->  $(basename "$out")  (CRF $CRF, preset $PRESET, max h=$MAX_HEIGHT)"
  ffmpeg -y -hide_banner -loglevel warning -i "$f" \
    -c:v libx264 -preset "$PRESET" -crf "$CRF" \
    -vf "scale='min(iw,trunc(oh*a/2)*2)':'min(ih,$MAX_HEIGHT)',format=yuv420p" \
    -movflags +faststart \
    -c:a aac -b:a 128k -ac 2 \
    "$out"

  echo "  [post] $base  ->  $(basename "$poster")"
  ffmpeg -y -hide_banner -loglevel warning -i "$f" -frames:v 1 -q:v 2 "$poster"

  src_kb=$(du -k "$f"     | cut -f1)
  out_kb=$(du -k "$out"   | cut -f1)
  echo "         source=${src_kb}KB  output=${out_kb}KB"
done

echo
echo "Done. Now run:  DOTENV=.env.deploy npx tsx scripts/r2-resync.ts --apply --only=images"
