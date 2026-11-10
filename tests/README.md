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
    │   ├── sold-out.html               # no-availability message, no room table
    │   ├── partial-availability.html   # priced room last
    │   ├── all-rooms-unavailable.html
    │   ├── no-mark.html                # priced room table, no property mark
    │   ├── no-room-table.html          # property mark only
    │   ├── rows-without-prices.html    # room rows, no price cells, no-availability message
    │   └── missing.html  # no property mark, a script sends it to city/test-town.html
    └── city/
        └── test-town.html
```

## 🔩 Fixtures

Fixtures are hand-trimmed copies of Booking.com pages. The test server serves each file at its path under `fixtures/`, so `hotel/available.html` is `/hotel/available.html`.

`route()` in `scraper.test.mjs` handles the paths that don't just serve a file:

- `/hotel/old-name.html`, a renamed slug that redirects to `available.html`
- `/hotel/city-after-first.html`, which has rooms on the first date and goes to a city page on later dates
- `/hotel/hang-up.html`, where the server closes the connection, so the page fails to load

Each priced cell in `available.html` hides a "not available" span. A scraper that reads hidden text then fails the test.

Put a new property page under `hotel/` and give it the property mark, `<body id="b2hotelPage">`. Without the mark, its dates are unknown. If the first date's page ends up outside `/hotel/`, the scraper reports the property as missing.

Booking has shown the no-availability message only on pages without a room table, but `rows-without-prices.html` has both on purpose. The rows win, and the date is unknown.

The server answers the first request of each test with 202, as Booking does for the first page of a browser session. A redirect still answers 301. The server keeps the URL and user agent of each request, so a test can check what the scraper asked Booking for.

Save a real page into `fixtures/hotel/`, then trim it by hand. A saved property page is 2 to 3 MB, and a test needs a few lines of it.

```bash
node tests/save-snapshot.mjs <booking-url> <output-name>
```

## 📝 Notes

- Scraper tests skip themselves when Playwright isn't installed.
- A page with neither a room table nor the no-availability message waits 5 seconds. That makes three tests slow: the `no-room-table.html` test and the two whose pages end on a city page. Give each such test as few dates as it can.
- Logic tests call pure functions and need nothing else.
