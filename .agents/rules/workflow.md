# Development Workflow

- Pin exact versions when adding dependencies: `pnpm add -E`.
- Before committing, run `pnpm lint.write`, `pnpm lint.check` and `pnpm test`. All must pass.
- Changes to how the watchdog runs or what it reports need a changeset. `pnpm changeset` is interactive, so agents write the file by hand: `.changesets/<type>-<8 hex chars>.md`, with `bump`, `type` and `scope` as front matter and the changelog line as the body. Types and bumps: `scripts/README.md`.
