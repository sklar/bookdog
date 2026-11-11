# Development Workflow

- Pin exact versions when adding dependencies: `pnpm add -E`.
- Before committing, run `pnpm lint.write`, `pnpm lint.check` and `pnpm test`. All must pass.
- Changes to what the watchdog does or reports need a changeset, and so do dependency or tooling bumps that fix a bug or a security issue. `pnpm changeset` is interactive, so agents write the file by hand: `.changesets/<type>-<8 hex chars>.md`, with `bump`, `type` and `scope` as front matter and the changelog line as the body. Types and bumps: `scripts/README.md`.
