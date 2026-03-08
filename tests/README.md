# Tests

## 🧰 Stack

- Node built-in test runner (`node:test`)
- [Playwright](https://playwright.dev/) (scraper tests)

## 🧑‍🚀 Commands

| Command | Action |
|---------|--------|
| `pnpm test` | Run all tests |
| `pnpm test.alert` | Send test Slack alert (needs `.env`) |

## 🗂️ Structure

```
tests/
├── logic.test.mjs        # consecutive-run + dedup logic
├── scraper.test.mjs      # Playwright against local fixtures
├── send-test-alert.mjs   # dev util: send fake Slack alert
├── save-snapshot.mjs     # dev util: capture Booking.com fixture
└── fixtures/
    ├── available.html
    ├── sold-out.html
    ├── partial-availability.html
    └── all-rooms-unavailable.html
```

## 🔩 Fixtures

HTML snapshots of Booking.com property pages served by a local HTTP server during tests. Capture new fixtures with:

```bash
node tests/save-snapshot.mjs <booking-url> <output-name>
```

## 📝 Notes

- Scraper tests require Playwright; automatically skipped if not installed
- Logic tests are pure functions, no external dependencies
