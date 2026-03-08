# Semver + Changesets

Lightweight versioning using semver (`MAJOR.MINOR.PATCH`) paired with an interactive changeset CLI.

## Workflow

1. Run `pnpm changeset` — interactive prompt asks for bump type, change category, scope, and summary
2. A markdown file is created in `.changesets/` — include it with your PR
3. On merge to `main`, the [release workflow](../.github/workflows/release.yml) auto-processes changesets: computes next semver from the highest `bump` field, generates grouped changelog, updates CHANGELOG.md, tags, and creates a GitHub Release

## Change types

| Type | Description |
|------|-------------|
| `chore` | Clean-ups, minor tweaks, not visible to user |
| `ci` | Build, deploy, dependencies, workflows |
| `doc` | Documentation (README, guides) |
| `feature` | New functionality or integration |
| `fix` | Bug fix, broken link, typo |
| `test` | Test additions or changes |

Type and scope are optional. Untyped entries appear ungrouped at the end of the changelog.

## Bump types

| Bump | When to use |
|------|-------------|
| `patch` | Bug fixes, minor tweaks |
| `minor` | New features, non-breaking changes |
| `major` | Breaking changes |

The highest bump across all changesets in a release wins (major > minor > patch).
