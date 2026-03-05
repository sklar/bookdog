# Bookdog

Booking.com availability watchdog — scrapes properties daily via GitHub Actions, detects consecutive available nights, alerts via Slack.

See [GUIDE.md](GUIDE.md) for setup, troubleshooting, and usage.
See [.claude/SPEC.md](.claude/SPEC.md) for full specification.

## 🧰 Stack

- Node 20 (ESM)
- [Playwright](https://playwright.dev/) (browser automation)
- [Google Sheets API](https://developers.google.com/sheets/api) (config & state)
- Slack Incoming Webhooks (alerts)
- [GitHub Actions](https://github.com/features/actions) (daily cron)
- [Biome](https://biomejs.dev/) (lint + format)

## 🗂️ Project Structure

```
/
├── src/
│   ├── check.mjs       # main entrypoint
│   ├── config.mjs      # Google Sheet config reader
│   ├── scraper.mjs     # Playwright availability prober
│   ├── slack.mjs       # Slack message formatting
│   └── state.mjs       # dedup state read/write
├── test/
│   └── fixtures/
├── .github/
│   └── workflows/
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

## ✋ Disclaimer

This tool scrapes Booking.com respectfully with polite delays. Use responsibly and in accordance with Booking.com's terms of service.
