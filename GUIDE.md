# Guide

## 🏗️ Setup

1. **Google Cloud service account**: Create one, enable Sheets API, download JSON key
2. **Google Sheet**: Create with `config` and `state` tabs (headers per SPEC.md)
3. **Share sheet** with the service account email
4. **Google Form**: Link to `config` tab, add Apps Script trigger for auto-ID (see SPEC.md §11)
5. **Slack webhooks**: Create production + test channel webhooks
6. **GitHub Secrets**:
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — full JSON key content
   - `GOOGLE_SHEET_ID` — from sheet URL (`/d/{ID}/edit`)
   - `SLACK_WEBHOOK_URL` — production channel
   - `SLACK_WEBHOOK_URL_TEST` — test channel

## 🚀 Usage

### Add a watchdog
Fill out the Google Form. The ID and enabled flag are auto-generated.

### Edit watchdog
Open the Google Sheet directly. Set `enabled` to `FALSE` to pause, or delete the row.

### Cron schedule
Default: 8:00 UTC. Edit in `.github/workflows/check-availability.yml`.

## 🔍 Troubleshooting

| Problem | Fix |
|---------|-----|
| No alerts sent | Check `SLACK_WEBHOOK_URL` secret, verify watchdog `enabled=TRUE` |
| Scraper fails | Booking.com may have changed DOM. Update selectors in `scraper.mjs`, refresh fixtures |
| All dates show unavailable | Check property URL is correct. Update selectors if Booking.com changed DOM |
| Config loading fails | Verify `GOOGLE_SERVICE_ACCOUNT_KEY` and sheet sharing |
| Duplicate alerts | State tab may be corrupted. Check `state` tab in Google Sheet |

## 💰 Free tier budget

- 1 run/day × 30 days = 30 runs
- ≤15 watchdogs: ~750 min/month
- 20+ watchdogs: consider batching (see SPEC.md)
