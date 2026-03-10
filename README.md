# Bookdog

[![Integration Test](https://github.com/sklar/bookdog/actions/workflows/integration-test.yml/badge.svg)](https://github.com/sklar/bookdog/actions/workflows/integration-test.yml)

Booking.com availability watchdog — scrapes properties daily via GitHub Actions, detects consecutive available nights, alerts via Slack.

- [Setup, usage and troubleshooting guide](GUIDE.md)
- [Full specification](.claude/SPEC.md)

## 🧰 Stack

- [Node 20](https://nodejs.org/) (ESM)
- [Playwright](https://playwright.dev/) (browser automation)
- [Google Sheets API](https://developers.google.com/sheets/api) (config & state)
- Slack Incoming Webhooks (alerts)
- [GitHub Actions](https://github.com/features/actions) (daily cron)
- [Biome](https://biomejs.dev/) (lint + format)

## 🗂️ Project Structure

```
/
├── .changesets/          # changeset files for releases
├── .github/
│   ├── renovate.json5
│   ├── scripts/          # release helper scripts
│   └── workflows/
│       ├── check-availability.yml
│       ├── integration-test.yml
│       ├── pr.yml
│       └── release.yml
├── scripts/
│   └── changeset.mjs     # interactive changeset CLI
├── src/
│   ├── check.mjs         # main entrypoint
│   ├── config.mjs        # Google Sheet config reader
│   ├── scraper.mjs       # Playwright availability prober
│   ├── slack.mjs         # Slack message formatting
│   └── state.mjs         # dedup state read/write
├── tests/
│   └── fixtures/
├── biome.jsonc
└── package.json
```

## 🧑‍🚀 Commands

| Command | Action |
|---------|--------|
| `pnpm check` | Run availability check (CI) |
| `pnpm check.dry` | Run locally with `.env` |
| `pnpm test` | Run unit + scraper tests |
| `pnpm test.alert` | Send test Slack alert |
| `pnpm lint.check` | Check with Biome |
| `pnpm lint.write` | Fix with Biome |
| `pnpm changeset` | Create a new changeset |

## ✋ Disclaimer

This is a personal hobby project, not affiliated with or endorsed by Booking.com. It scrapes publicly available property pages with polite delays between requests. Automated access may violate [Booking.com's terms of service](https://www.booking.com/content/terms.html) — use at your own risk. The author assumes no liability.

## 📄 License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and non-commercial use.
