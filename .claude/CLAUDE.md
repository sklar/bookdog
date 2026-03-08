# Bookdog

Booking.com availability watchdog. GitHub Actions cron (daily) scrapes property pages via Playwright, detects consecutive available nights, alerts via Slack. Config and state stored in Google Sheets.

See [SPEC.md](SPEC.md) for full specification. Licensed under [PolyForm Noncommercial 1.0.0](../LICENSE).

## Tech Stack

- **Runtime**: Node 20 ESM (`.mjs` files)
- **Package manager**: pnpm
- **Browser automation**: Playwright (Chromium)
- **Config & state**: Google Sheets API (`googleapis`)
- **Notifications**: Slack Incoming Webhooks
- **CI**: GitHub Actions (cron + matrix jobs)
- **Linting/Formatting**: Biome

## Key Modules

- `src/config.mjs` — reads watchdog configs from Google Sheet, writes matrix JSON to file (CI) or stdout (local)
- `src/state.mjs` — read/write dedup state (alerted runs) in Google Sheet
- `src/scraper.mjs` — per-date probing with per-row availability detection
- `src/check.mjs` — main entrypoint: scrape → find consecutive runs → dedup → alert → write state
- `src/slack.mjs` — Slack message formatting and delivery
