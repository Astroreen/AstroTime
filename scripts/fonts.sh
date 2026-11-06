#!/usr/bin/env bash
# Makes the bundled fonts (docs/plans/design.md#D294) in packages/ui/src/fonts/:
# each from its Fontsource package (the Google Fonts files, SIL OFL 1.1), in
# the four subsets AstroTime ships (latin, latin-ext, cyrillic, cyrillic-ext),
# a variable font narrowed to the weights the type scale uses (400 to 600,
# design D134) with fontTools, PT Sans in its two static weights, and the
# licence beside the files as OFL.txt. Needs npm and nix (for fontTools).
#
#   scripts/fonts.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/packages/ui/src/fonts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# id, package: the variable ones first.
variable=(
  "inter @fontsource-variable/inter@5.3.0"
  "roboto @fontsource-variable/roboto@5.3.0"
  "noto-sans @fontsource-variable/noto-sans@5.3.0"
  "nunito @fontsource-variable/nunito@5.3.0"
  "literata @fontsource-variable/literata@5.3.0"
  "jetbrains-mono @fontsource-variable/jetbrains-mono@5.3.0"
)
static=("pt-sans @fontsource/pt-sans@5.3.0")
subsets=(latin latin-ext cyrillic cyrillic-ext)

unpack() {
  local id="$1" package="$2"
  mkdir -p "$work/$id" "$out/$id"
  (cd "$work/$id" && npm pack --silent "$package" >/dev/null && tar xzf ./*.tgz)
  cp "$work/$id/package/LICENSE" "$out/$id/OFL.txt"
}

cat >"$work/narrow.py" <<'EOF'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
font = instancer.instantiateVariableFont(TTFont(sys.argv[1]), {"wght": (400, 600)})
font.flavor = "woff2"
font.save(sys.argv[2])
EOF

for entry in "${variable[@]}"; do
  read -r id package <<<"$entry"
  unpack "$id" "$package"
  for subset in "${subsets[@]}"; do
    nix-shell -p "python3.withPackages (p: [ p.fonttools p.brotli ])" --run \
      "python3 -I '$work/narrow.py' '$work/$id/package/files/$id-$subset-wght-normal.woff2' '$out/$id/$subset.woff2'"
  done
done

for entry in "${static[@]}"; do
  read -r id package <<<"$entry"
  unpack "$id" "$package"
  for subset in "${subsets[@]}"; do
    for weight in 400 700; do
      cp "$work/$id/package/files/$id-$subset-$weight-normal.woff2" "$out/$id/$subset-$weight.woff2"
    done
  done
done

du -cb "$out"/*/*.woff2 | tail -1
