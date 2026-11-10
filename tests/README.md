# Tests

## 🧰 Stack

- [Node 26](https://nodejs.org/) built-in test runner, `node:test`
- [Playwright](https://playwright.dev/) for the scraper tests

## 🧑‍🚀 Commands

| Command | Action |
|---------|--------|
| `pnpm test` | Run all tests |
| `pnpm test.alert` | Send a sample stretch message and error message to Slack, needs `.env` |

## 🗂️ Structure

```
tests/
├── logic.test.mjs        # stretch + dedup logic
├── scraper.test.mjs      # Playwright against local fixtures
├── watchdog.test.mjs     # one watchdog: fake scrape, in-memory state, local Slack
├── send-test-alert.mjs   # sends the sample Slack messages
├── save-snapshot.mjs     # saves a Booking.com page as a fixture
└── fixtures/
    ├── hotel/            # served under /hotel/
    │   ├── available.html
    │   ├── sold-out.html
    │   ├── partial-availability.html
    │   ├── all-rooms-unavailable.html
    │   ├── all-rooms-unavailable.de.html  # German, read only without lang=en-gb
    │   └── missing.html  # no property mark, a script sends it to city/test-town.html
    └── city/
        └── test-town.html
```

## 🔩 Fixtures

Fixtures are hand-trimmed copies of Booking.com pages. The test server serves each file at its path under `fixtures/`, so `hotel/available.html` is `/hotel/available.html`.

`route()` in `scraper.test.mjs` handles the paths where Booking does more:

- a renamed slug, which redirects to `available.html`
- a property that goes to a city page after the first date
- a `.de.html` page, which `lang=en-gb` sends to the English fixture of the same name

Each priced cell in `available.html` hides a "not available" span. A scraper that reads hidden text then fails the test.

Put a new property page under `hotel/` and give it the property mark, `<body id="b2hotelPage">`. If the first date's page ends up outside `/hotel/`, the scraper reports the property as missing.

The server answers the first request of each test with 202, as Booking does for the first page of a browser session. A redirect still answers 301. It keeps the URL and user agent of each request, so a test can check what the scraper asked Booking for.

Save a real page into `fixtures/hotel/`, then trim it by hand. A saved property page is 2 to 3 MB, and a test needs a few lines of it.

```bash
node tests/save-snapshot.mjs <booking-url> <output-name>
```

## 📝 Notes

- Scraper tests skip themselves when Playwright isn't installed.
- A page with neither a room table nor the no-availability message waits 5 seconds, so the missing-property tests are the slow ones.
- Logic tests call pure functions and need nothing else.
