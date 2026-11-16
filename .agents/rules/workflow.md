# Development Workflow

- Pin exact versions when adding dependencies: `pnpm add -E`.
- Before committing, run `pnpm lint.write`, `pnpm lint.check` and `pnpm test`. All must pass.
- Changes to what the watchdog does or reports need a changeset. So does each promotion to `main` that carries dependency updates, with one changeset for all of them: `bump: patch`, `type: ci`, `scope: deps`, and each update with its new version. `pnpm changeset` is interactive, so agents write the file by hand: `.changesets/<type>-<8 hex chars>.md`, with `bump`, `type` and `scope` as front matter and the changelog line as the body. Types and bumps: `scripts/README.md`.
