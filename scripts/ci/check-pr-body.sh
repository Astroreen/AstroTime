#!/usr/bin/env bash
# Checks the PR description the owner reads (.github/pull_request_template.md):
#
# 1. No files on someone's disk instead of pictures: "/home/…/after.png",
#    ".sisyphus/…", "`before-menu.png`". GitHub cannot display those, so the
#    owner sees no pictures. Anything inside an http(s) link is fine; a file
#    name outside one is not. Upload with scripts/pr-images.sh.
# 2. The short shape: the problem first, then "What changed" (pictures under
#    each change), "Risk" with how to undo, at most 5 "How to check" steps, and the proof in one
#    line or a collapsed <details>. Separate "Why", "Tests", "Screenshots",
#    "Before / after" and "Docs" sections say the same things twice.
# 3. At most MAX_WORDS words outside <details>, code, comments and links: a
#    description the owner reads in two or three minutes.
#
# The shape and its reasons: docs/plans/foundation.md#D312.
#
# Usage: PR_BODY="…" scripts/ci/check-pr-body.sh
set -euo pipefail

body="${PR_BODY-}"
# Drop links, HTML comments (the template's hints) and fenced code blocks
# (quoted command output), keep the rest. Plain awk: the CI runner has no perl.
text="$(printf '%s\n' "$body" | awk '
	/^[ \t]*```/ { fence = !fence; print ""; next }
	fence { print ""; next }
	{
		out = ""
		while (1) {
			if (comment) {
				end = index($0, "-->")
				if (!end) { $0 = ""; break }
				$0 = substr($0, end + 3); comment = 0
			}
			start = index($0, "<!--")
			if (!start) break
			out = out substr($0, 1, start - 1); $0 = substr($0, start + 4); comment = 1
		}
		line = out $0
		gsub(/https?:\/\/[^ \t)"<>]+/, "", line)
		print line
	}')"

pattern='(/home/|file://)[^ `)]*'
# Other disks' paths count only when they name a picture or video: `~/.config`
# in a description is fine, `~/shots/after.png` is not.
pattern="$pattern|(/Users/|/tmp/|~/|[A-Za-z]:\\\\)[^ \`)]*\\.(png|jpe?g|gif|webp|mp4|webm|mov)\\b"
# A bare image name ("`after-menu.png`") counts only when nothing is shown at
# all; with real pictures present it is probably a file the code changes.
if ! printf '%s' "$body" | grep -qE '!\[[^]]*\]\(https?://|<img [^>]*src="https?://|user-attachments/assets/'; then
	pattern="$pattern|[A-Za-z0-9_.-]+\.(png|jpe?g|gif|webp|mp4|webm|mov)\b"
fi
found="$(printf '%s\n' "$text" | grep -noE "$pattern" || true)"

if [ -n "$found" ]; then
	echo "The PR description names files on a local disk; GitHub cannot show them:" >&2
	printf '%s\n' "$found" | sed 's/^/  line /' >&2
	echo "Upload them with: scripts/pr-images.sh <pr-number> <file>...  and paste the Markdown it prints." >&2
	exit 1
fi

problems=()
has() { printf '%s\n' "$text" | grep -qiE "$1"; }
for section in 'What changed' 'Risk' 'How to check'; do
	has "^## +${section}[[:space:]]*\$" || problems+=("no \"## $section\" section")
done
has '<summary>[^<]*proof|\*\*proof' ||
	problems+=("no proof: a \"**Proof:**\" line or <details><summary>Proof</summary>")
old="$(printf '%s\n' "$text" | grep -ioE '^## +(why|tests|screenshots|before ?/ ?after|docs|proof|risk and undo)\b' || true)"
[ -z "$old" ] || problems+=("old sections, now merged: ${old//$'\n'/, } — before/after goes under each change, tests, docs and proof into Proof")
risk="$(printf '%s\n' "$text" | awk '/^## /{in_risk = tolower($0) ~ /^## +risk/; next} in_risk')"
printf '%s' "$risk" | grep -qi 'undo' || problems+=("\"## Risk\" does not say how to undo")
steps="$(printf '%s\n' "$text" | awk '/^## /{in_check = tolower($0) ~ /^## +how to check/; next} /<details/{in_check = 0} in_check && /^[0-9]+\./' | wc -l)"
[ "$steps" -le 5 ] || problems+=("$steps steps in \"## How to check\" (at most 5)")

# Words the owner reads before opening anything: outside <details>, without
# picture alt texts, table pipes and Markdown marks.
words="$(printf '%s\n' "$text" | awk '
	/<details/ { hidden++ }
	!hidden { print }
	/<\/details>/ { if (hidden) hidden-- }' |
	sed -E 's/!\[[^]]*\]\(\)//g; s/<[^>]*>//g; s/[][|#*`>()_~-]+/ /g' | wc -w)"
max="${MAX_WORDS:-300}"
[ "$words" -le "$max" ] ||
	problems+=("$words words outside <details> (at most $max): say each fact once, move test details into Proof")

if [ "${#problems[@]}" -gt 0 ]; then
	echo "The PR description is not in the short shape of .github/pull_request_template.md:" >&2
	printf '  - %s\n' "${problems[@]}" >&2
	exit 1
fi
echo "PR description: no local file paths, short shape ($words words)."
