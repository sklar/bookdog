#!/usr/bin/env bash
set -euo pipefail

LATEST=$(git tag --list 'v*' | sort -V | tail -1 | sed 's/^v//')
[ -z "$LATEST" ] && LATEST="0.0.0"

MAJOR=$(echo "$LATEST" | cut -d. -f1)
MINOR=$(echo "$LATEST" | cut -d. -f2)
PATCH=$(echo "$LATEST" | cut -d. -f3)

MAX_BUMP="patch"
for file in .changesets/*.md; do
  [ -f "$file" ] || continue
  [[ "$(basename "$file")" == ".gitkeep" ]] && continue
  BUMP=$(grep '^bump:' "$file" | sed 's/bump: //')
  if [ "$BUMP" = "major" ]; then
    MAX_BUMP="major"
  elif [ "$BUMP" = "minor" ] && [ "$MAX_BUMP" != "major" ]; then
    MAX_BUMP="minor"
  fi
done

case "$MAX_BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo "version=$VERSION" >> "$GITHUB_OUTPUT"
echo "tag=v$VERSION" >> "$GITHUB_OUTPUT"
echo "Version: v$VERSION"
