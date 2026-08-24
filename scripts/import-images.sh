#!/usr/bin/env bash
# Import Chris Valencia's portfolio from the Powerline Tattoo repo and
# re-encode it for the web (macOS `sips`, no extra tooling required).
#
#   PNG  ~1500 px, ~1.4 MB each  ->  JPEG, longest edge 1400 px, quality 82
#                                    (steps down to 76/70/64 only if a file
#                                     would exceed MAX_BYTES, default 400 KB)
#   headshot JPEG 750 px          ->  JPEG, longest edge 800 px,  quality 85
#
# Usage: scripts/import-images.sh   (run from anywhere; it cd's to the repo root)
# Overrides: SRC_DIR=/path/to/gallery/chris-valencia  HEADSHOT_SRC=/path/to.jpg
#            MAX_BYTES=400000
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="${SRC_DIR:-$HOME/powerline-tattoo/public/images/gallery/chris-valencia}"
HEADSHOT="${HEADSHOT_SRC:-$HOME/powerline-tattoo/public/images/artists/chris-valencia.jpg}"
MAX_BYTES="${MAX_BYTES:-400000}"
OUT="public/images/portfolio"
MAX_PX=1400

if [ ! -d "$SRC" ]; then
  echo "Source directory not found: $SRC" >&2
  exit 1
fi

mkdir -p "$OUT"

count=0
for f in "$SRC"/chris-*.png; do
  b=$(basename "$f" .png)
  dest="$OUT/$b.jpg"
  size=0
  used=82
  for q in 82 76 70 64; do
    sips -s format jpeg -s formatOptions "$q" -Z "$MAX_PX" "$f" --out "$dest" >/dev/null
    size=$(stat -f %z "$dest")
    used=$q
    [ "$size" -le "$MAX_BYTES" ] && break
  done
  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "warning: $dest is $size bytes at q$used (> $MAX_BYTES)" >&2
  elif [ "$used" -ne 82 ]; then
    echo "note: $b.jpg needed q$used to fit under $MAX_BYTES bytes ($size)"
  fi
  count=$((count + 1))
done
echo "portfolio: $count images -> $OUT"

if [ -f "$HEADSHOT" ]; then
  sips -s format jpeg -s formatOptions 85 -Z 800 "$HEADSHOT" --out public/images/chris-valencia.jpg >/dev/null
  echo "headshot: public/images/chris-valencia.jpg"
else
  echo "headshot not found: $HEADSHOT (skipped)" >&2
fi
