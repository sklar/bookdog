# Guide

## 🏗️ Setup

1. **Google Cloud service account**<br>
   Create one, enable Sheets API, download JSON key
2. **Google Sheet**<br>
   Create with `config` and `state` tabs (headers per [docs/SPEC.md](docs/SPEC.md#google-sheet-structure))
3. **Share sheet** with the service account email
4. **Google Form** (optional)<br>
   Link to `config` tab, add Apps Script trigger for auto-ID (see [docs/SPEC.md §11](docs/SPEC.md#11-google-form--apps-script-auto-id-setup))
5. **Slack webhooks**<br>
   Create one webhook for the production channel and one for the test channel
6. **GitHub Secrets**:
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: full JSON key content
   - `GOOGLE_SHEET_ID`: from sheet URL (`/d/{ID}/edit`)
   - `SLACK_WEBHOOK_URL`: production channel
   - `SLACK_WEBHOOK_URL_TEST`: test channel

## 🚀 Usage

### Add a watchdog
Fill out the Google Form. The Apps Script fills in the ID and enabled flag.

The property URL must start with `https://www.booking.com/hotel/`. Any other URL gives an error message and a red workflow run, even when the window is finished.

The URL can be in any language, such as `.de.html`. The watchdog reads the English page, and the links in Slack keep the URL's language.

The watchdog ignores everything after `?` in the URL. A URL copied from a Booking search carries that search's guests, and Booking would use them in place of the watchdog's.

Without a name, the Slack messages take their title from the URL: `grand-hotel.en-gb.html` gives "Grand Hotel".

### Edit a watchdog
Open the Google Sheet directly. Set `enabled` to `FALSE` to pause, or delete the row.

### Window
The check-in and check-out dates in the form set the window, and every stay fits inside it. The first check-in is the window's start or today in UTC, whichever is later. The last check-in is the window's end minus minimum nights. With Jul 1 to Jul 10 and a minimum of 3, that's Jul 7, and the stay checks out on Jul 10.

A window with no possible check-in date is finished. That includes a window shorter than the minimum nights. The watchdog loads no pages and sends no message, and the workflow run stays green. Because it loads no pages, it can't find a [missing property](#missing-property) either.

A window is invalid if its start is after its end, if it has an impossible date such as `2026-02-30`, or if it's longer than 500 days. The watchdog loads no pages, sends an error message and makes the workflow run red.

### Guests and minimum nights
A blank, zero, negative or unreadable number for adults, children or minimum nights takes its default: 1 adult, 0 children and 3 minimum nights.

Booking doesn't count a child without an age, and the Sheet has no ages. So the watchdog asks for each child as 13 years old. `CHILD_AGE` in `src/constants.mjs` sets it.

### Date results
For each check-in date, the watchdog loads the property page with a stay of the minimum nights. The date comes out one of three ways:

- **Available.** At least one room has a price.
- **Sold out.** Every room says "not available", or Booking shows its "We have no availability here" message where the room table would be.
- **Unknown.** Anything else, such as a page that fails to load, a block page under `/hotel/`, or a property page that Booking has changed.

A sold out or unknown date ends a stretch, so a message never covers a night the watchdog couldn't verify. The log counts how many dates got each result. A check on your machine also logs each date, with the reason when it's unknown.

### Alerts
Each stretch gets one Slack message, even if it stays free for weeks. If one workflow run doesn't find the stretch and a later one does, the watchdog sends another.

### Missing property
When Booking no longer has a property, it sends visitors from the property's page to another page, such as a city page. The watchdog loads the first date only, sends a Slack message with the address Booking sends visitors to, and makes the workflow run red. The message comes every day until one of these happens:

- Booking lists the property again. The message stops by itself.
- You set `enabled` to `FALSE` in the Sheet.

Only the first date decides. A later date whose page goes elsewhere is [unknown](#date-results) and doesn't raise the alarm. A property that Booking renames keeps working, as long as its page stays under `/hotel/`.

### Cron schedule
The workflow starts daily at 6:00 UTC, then waits a random time of up to an hour. That's 7:00 to 8:00 in Central European winter time and 8:00 to 9:00 in summer time. The cron line is in `.github/workflows/check-availability.yml`.

## 🎯 Troubleshooting

| Problem | Fix |
|---------|-----|
| No alerts sent | Check the `SLACK_WEBHOOK_URL` secret, the watchdog's `enabled=TRUE` and whether its [window](#window) is finished |
| Error about the window | Fix the row's dates in the Google Sheet. See [Window](#window) |
| Error about the property URL | Put the property's Booking page in the Sheet, starting with `https://www.booking.com/hotel/`. See [Add a watchdog](#add-a-watchdog) |
| "Booking no longer has this property" | Open the link in the message. If the property has a new page under `/hotel/`, put its URL in the Sheet. Otherwise set `enabled=FALSE`. See [Missing property](#missing-property) |
| Error message from the scraper | The browser itself failed, for example after a Playwright update. Run `pnpm test` on your machine. A Booking page that changed doesn't cause this error. Its dates come out unknown instead. See the next two rows |
| No date is ever available | Open the property URL with a few of the window's dates. If Booking shows rooms there, the watchdog may read those dates as unknown. See the next row |
| Unknown dates | `cleanup.yml` deletes the log of a green workflow run, so check on your machine. Put the watchdog's row in `WATCHDOG_CONFIG` in `.env` and run `pnpm check.dry`. Its log shows each date's result and why a date is unknown. If Booking blocks the scraper, the pages fail or have no property mark. If Booking changed its pages, save one with `node tests/save-snapshot.mjs <booking-url> <output-name>`, then update the rules in `scraper.mjs` and the fixtures. See [Date results](#date-results) |
| Loading the `config` tab fails | Check the `GOOGLE_SERVICE_ACCOUNT_KEY` secret, and that the Sheet is shared with the service account |
| Duplicate alerts | Expected if a stretch went away and came back. See [Alerts](#alerts). A workflow run that sent the message but couldn't write state also repeats it the next day, and sends an error message too. Otherwise check the watchdog's row in the `state` tab of the Google Sheet |
| Can't see workflow run logs | `cleanup.yml` deletes successful workflow runs, logs included. Failed workflow runs stay, so you can debug them |

## 💰 Free tier budget

- 1 workflow run/day × 30 days = 30 workflow runs
- ≤15 watchdogs: ~750 min/month
- 20+ watchdogs: consider batching (see SPEC.md)