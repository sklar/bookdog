# Bookdog

Booking.com availability watchdog. GitHub Actions cron (daily) scrapes property pages via Playwright, detects consecutive available nights, alerts via Slack. Config and state stored in Google Sheets.

Pipeline, from `src/watchdog.mjs`: choose dates → scrape → find stretches → dedup → alert → write state.

Original build plan: [docs/SPEC.md](docs/SPEC.md).

Code standards: @.agents/rules/code-standards.md
Development workflow: @.agents/rules/workflow.md

## Gotchas

- Commit to `next`, then promote through one PR `next` → `main`. `main` runs the cron.
- A push to `main` with files in `.changesets/` makes a release, and the bot commits directly to `main`.
- `mise.toml` pins Node and pnpm on the dev machine only. CI reads `engines.node` and `packageManager`, so change each version in both places.
- The repo and Actions logs are public. Keep Sheet data out of commits, PR text and log output.
- `cleanup.yml` deletes successful Check Availability runs from every branch, logs included. A debug run must exit non-zero to keep its logs.
- `dry_run` also skips Slack error messages. Testing them needs `dry_run=false`.
- Integration Test has no dry run: it posts to the test Slack channel and can write state.

## Agent skills

### Issue tracker

Local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Use the words in `CONTEXT.md` when naming a domain concept in code, tests or tickets. See `docs/agents/domain.md`.
