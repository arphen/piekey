#!/bin/bash
# Pre-publish report: what this push sends, and which branches are not yet integrated into main.
set -u
cd "$(git rev-parse --show-toplevel)"
branch=$(git rev-parse --abbrev-ref HEAD)
git fetch --quiet origin 2>/dev/null || echo "(fetch failed; remote state may be stale)"

mainref=main; git rev-parse --verify --quiet origin/main >/dev/null && mainref=origin/main

echo "== Delta to publish: $branch -> $mainref (this is what goes live) =="
if git rev-parse --verify --quiet "$mainref" >/dev/null; then range="$mainref..HEAD"; else range="HEAD"; fi
count=$(git rev-list --count $range)
if [ "$count" = 0 ]; then echo "  nothing new to push"; else
  git log --format='  %h %s' $range | head -20
  [ "$count" -gt 20 ] && echo "  ... $count commits in total"
  git diff --shortstat "$mainref" HEAD | sed 's/^/  /'
fi
echo
echo "== Against $mainref =="
if git rev-parse --verify --quiet "$mainref" >/dev/null; then
  read -r behind ahead < <(git rev-list --left-right --count "$mainref"...HEAD)
  echo "  $branch is $ahead ahead, $behind behind $mainref"
  [ "$branch" != main ] && [ "$ahead" -gt 0 ] && echo "  main does not have these yet"
else echo "  no main"; fi

echo
echo "== Branches not integrated into $mainref =="
loose=0
while read -r ref; do
  ref=${ref#\* }; ref=$(echo "$ref" | xargs)
  case "$ref" in ""|main|origin|origin/main|origin/HEAD*|"(HEAD"*) continue;; esac
  # a remote branch that equals its local twin is the same loose end
  if [[ "$ref" == origin/* ]] && [ "$(git rev-parse --verify --quiet "${ref#origin/}")" = "$(git rev-parse "$ref")" ]; then continue; fi
  n=$(git rev-list --count "$mainref..$ref" 2>/dev/null) || continue
  [ "$n" = 0 ] && continue
  loose=1
  printf '  %-34s %4s commits ahead  (%s)\n' "$ref" "$n" "$(git log -1 --format=%cr "$ref")"
done < <(git branch -a --no-merged "$mainref" --format='%(refname:short)')
[ "$loose" = 0 ] && echo "  none"
echo
