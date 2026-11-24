#!/usr/bin/env bash
# Uploads a PR's screenshots/videos to GitHub and prints the Markdown to paste
# into the PR body. A path on your disk shows nothing on the PR page.
#
# The files go to the branch assets/pr-<number> (images only, no code, never
# merged), one branch per PR. Running it again for the same PR adds or
# replaces files and keeps the rest. → docs/plans/foundation.md#D312
#
# Usage: scripts/pr-images.sh <pr-number> <file>...
#   e.g. scripts/pr-images.sh 171 .github/pr-assets/before-edit-dark-en-phone.png .github/pr-assets/after-edit-dark-en-phone.png
set -euo pipefail

pr="${1:?usage: $0 <pr-number> <file>...}"
shift
[ "$#" -gt 0 ] || { echo "usage: $0 <pr-number> <file>..." >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
branch="assets/pr-$pr"
repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

# Start from the files already on the branch, if any.
tree_in="$(mktemp)"
trap 'rm -f "$tree_in"' EXIT
parent=()
if git fetch -q origin "refs/heads/$branch" 2>/dev/null; then
	git ls-tree FETCH_HEAD >"$tree_in"
	parent=(-p FETCH_HEAD)
fi

for f in "$@"; do
	[ -f "$f" ] || { echo "no such file: $f" >&2; exit 1; }
	name="$(basename "$f")"
	hash="$(git hash-object -w "$f")"
	awk -F '\t' -v name="$name" '$2 != name' "$tree_in" >"$tree_in.new"
	mv "$tree_in.new" "$tree_in"
	printf '100644 blob %s\t%s\n' "$hash" "$name" >>"$tree_in"
done

tree="$(git mktree <"$tree_in")"
commit="$(echo "Screenshots for PR #$pr (not code; kept for the PR page)" | git commit-tree "$tree" ${parent[@]+"${parent[@]}"})"
git push -q origin "$commit:refs/heads/$branch"

for f in "$@"; do
	name="$(basename "$f")"
	ext="${name##*.}"
	url="https://github.com/$repo/blob/$branch/$name?raw=true"
	case "$ext" in
	mp4 | webm | mov) echo "[$name]($url)" ;;
	*) echo "![${name%.*}]($url)" ;;
	esac
done
