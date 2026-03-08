# Development Workflow

- Use `pnpm` for all package management (not `npm` or `yarn`).
- Pin exact versions when adding dependencies or devDependencies (no `^` or `~` ranges).
- Format and lint with `pnpm lint.write` before committing.
- Verify changes with `pnpm lint.check` — should produce 0 errors.
- For user-facing changes, run `pnpm changeset` to create a changeset file in `.changesets/`.
