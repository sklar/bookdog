#!/usr/bin/env bash
set -euo pipefail

VERSION="$1"
ENTRY="## ${VERSION}\n\n"

declare -A TYPE_LABELS=(
  [chore]="Chores"
  [ci]="CI"
  [doc]="Docs"
  [feature]="Features"
  [fix]="Fixes"
  [test]="Tests"
)

declare -A GROUPED
UNGROUPED=""

for file in .changesets/*.md; do
  [ -f "$file" ] || continue
  [[ "$(basename "$file")" == ".gitkeep" ]] && continue

  TYPE=$(grep '^type:' "$file" | sed 's/type: //' || true)
  SCOPE=$(grep '^scope:' "$file" | sed 's/scope: //' || true)
  BODY=$(awk '/^---$/{n++; next} n>=2' "$file" | sed '/^$/d')

  COMMIT_SHA=$(git log --diff-filter=A --format="%H" -- "$file" | head -1)
  SHORT_SHA=""
  PR_NUM=""
  if [ -n "$COMMIT_SHA" ]; then
    SHORT_SHA=$(echo "$COMMIT_SHA" | cut -c1-7)
    PR_NUM=$(gh pr list --state merged --search "$COMMIT_SHA" --json number --jq '.[0].number' 2>/dev/null || true)
  fi

  LINE="- "
  if [ -n "$PR_NUM" ]; then
    LINE+="#${PR_NUM} "
  fi
  if [ -n "$SHORT_SHA" ]; then
    LINE+="\`${SHORT_SHA}\` "
  fi
  if [ -n "$SCOPE" ]; then
    LINE+="**${SCOPE}**: ${BODY}"
  else
    LINE+="${BODY}"
  fi

  if [ -n "$TYPE" ]; then
    GROUPED[$TYPE]+="${LINE}\n"
  else
    UNGROUPED+="${LINE}\n"
  fi
done

for TYPE in feature fix chore ci doc test; do
  if [ -n "${GROUPED[$TYPE]:-}" ]; then
    LABEL="${TYPE_LABELS[$TYPE]}"
    ENTRY+="### ${LABEL}\n\n${GROUPED[$TYPE]}\n"
  fi
done

if [ -n "$UNGROUPED" ]; then
  ENTRY+="${UNGROUPED}\n"
fi

echo -e "$ENTRY" > /tmp/changelog_entry.md
echo -e "$ENTRY" > /tmp/release_body.md
