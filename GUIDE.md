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
   Create production + test channel webhooks
6. **GitHub Secrets**:
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: full JSON key content
   - `GOOGLE_SHEET_ID`: from sheet URL (`/d/{ID}/edit`)
   - `SLACK_WEBHOOK_URL`: production channel
   - `SLACK_WEBHOOK_URL_TEST`: test channel

## 🚀 Usage

### Add a watchdog
Fill out the Google Form. The Apps Script fills in the ID and enabled flag.

### Edit watchdog
Open the Google Sheet directly. Set `enabled` to `FALSE` to pause, or delete the row.

### Window
The check-in and check-out dates in the form set the window, and every stay fits inside it. The first check-in is the window's start or today in UTC, whichever is later. The last check-in is the window's end minus minimum nights. With Jul 1 to Jul 10 and a minimum of 3, that's Jul 7, and the stay checks out on Jul 10.

A window with no possible check-in date is finished. That includes a window shorter than the minimum nights. The watchdog loads no pages and sends no message, and the workflow run stays green.

A window is invalid if its start is after its end, or if it has an impossible date such as `2026-02-30`. The watchdog loads no pages, sends an error message and makes the workflow run red.

### Cron schedule
Daily between 7:00–8:00 CET (randomized). Edit cron in `.github/workflows/check-availability.yml`.

## 🎯 Troubleshooting

| Problem | Fix |
|---------|-----|
| No alerts sent | Check the `SLACK_WEBHOOK_URL` secret, the watchdog's `enabled=TRUE` and whether its [window](#window) is finished |
| Error says the window has an impossible date | Fix the row's dates in the Google Sheet. See [Window](#window) |
| Scraper fails | Booking.com may have changed DOM. Update selectors in `scraper.mjs`, refresh fixtures |
| All dates show unavailable | Check property URL is correct. Update selectors if Booking.com changed DOM |
| Config loading fails | Verify `GOOGLE_SERVICE_ACCOUNT_KEY` and sheet sharing |
| Duplicate alerts | State tab may be corrupted. Check `state` tab in Google Sheet |
| Can't see workflow run logs | `cleanup.yml` deletes successful workflow runs, logs included. Failed workflow runs stay, so you can debug them |

## 💰 Free tier budget

- 1 workflow run/day × 30 days = 30 workflow runs
- ≤15 watchdogs: ~750 min/month
- 20+ watchdogs: consider batching (see SPEC.md)