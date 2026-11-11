# Tests

## 🧰 Stack

- [Node 26](https://nodejs.org/) built-in test runner, `node:test`
- [Playwright](https://playwright.dev/) for the scraper tests

## 🧑‍🚀 Commands

| Command | Action |
|---------|--------|
| `pnpm test` | Run all tests |
| `pnpm test.alert` | Send one sample of each Slack message, needs `.env` |

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
- `/hotel/unknown-once.html`, which has rooms, but Jul 1 has no property mark on its first load
- `/hotel/city-on-second-try.html`, which has rooms, but Jul 1 has no property mark on its first load and goes to a city page on its second
- `/hotel/hang-up.html`, where the server closes the connection, so the page fails to load

The two second-try routes count the earlier requests for the same path and check-in date. That's how they tell a first load from a second.

Each priced cell in `available.html` hides a "not available" span. A scraper that reads hidden text then fails the test.

Put a new property page under `hotel/` and give it the property mark, `<body id="b2hotelPage">`. Without the mark, its dates are unknown. If the first date's page ends up outside `/hotel/`, the scraper reports the property as missing.

Booking has shown the no-availability message only on pages without a room table, but `rows-without-prices.html` has both on purpose. The rows win, and the date is unknown.

The server answers the first request of each test with 202, as Booking does for the first page of a browser session. `old-name.html` answers 301 even on the first request. The server keeps the URL and user agent of each request, so a test can check what the scraper asked Booking for.

Save a real page into `fixtures/hotel/`, then trim it by hand. A saved property page is 2 to 3 MB, and a test needs a few lines of it.

```bash
node tests/save-snapshot.mjs <booking-url> <output-name>
```

## 📝 Notes

- Scraper tests skip themselves when Playwright isn't installed.
- The scraper waits up to 5 seconds for a room table or the no-availability message. A page under `/hotel/` with neither uses all 5, which makes the `no-room-table.html` test slow. A page that moves to a city page ends the wait once it leaves `/hotel/`. Give each test only the dates it needs.
- A second try needs 10 dates or more, because 1 unknown date of 9 is already more than 10%. Each worker pauses 1.5 to 3.5 seconds between its loads, so those tests pass `scrapeAvailability` a `pause` that returns at once.
- Logic tests call pure functions and need nothing else.
