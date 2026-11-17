# Changelog

## v1.2.0

### Features

- #4 `7b24888` **check**: Detect when Booking redirects the first date's page outside `/hotel/`, report the property as no longer listed on Booking, stop processing further pages, send a daily Slack message with the redirect URL, and fail the workflow run.
- #4 `b8a6770` **check**: Retry unknown dates once when they are 10% or less of the dates, so one slow page doesn't break a stretch. When more than 10% are unknown, skip the retry to avoid adding load to a site that may be blocking the scraper, send a Slack message with the number of unknown dates, the total and a link to the workflow run, and fail the workflow run. In that case, still alert on stretches found among the other dates, and keep the previously alerted stretches in state, so they don't alert again once those dates have answers again.
- #4 `d2b574e` **check**: Classify each date as available, sold out, or unknown, and mark it sold out only when the page proves it. Treat failed page loads, block pages, and unrecognised pages as unknown. End a stretch at an unknown date, so no alert covers a night nobody verified. Log how many dates got each result, and the reason for each unknown date.

### Fixes

- #4 `db58bc2` **check**: Send an alert when the number of available nights exactly matches the minimum, and show each available stretch with its actual length and check-out date.
- #4 `2151886` **CI**: Re-enable the workflows on every Check Availability run, so GitHub's 60-day inactivity rule doesn't stop the watchdogs without a word. That includes a workflow GitHub has already disabled for inactivity. A workflow you disable by hand stays disabled.
- #4 `7b24888` **check**: Load all property pages in English to avoid counting unavailable rooms as available on localized pages (e.g. `.de.html` URLs), read dates immediately when Booking displays its no-availability message instead of waiting 5 seconds, and send Booking the user agent of the Chrome version that runs.
- #4 `3700b51` **check**: Request only check-in dates that allow a stay within the specified window, skip notifications for expired windows, and report errors for reversed windows or invalid dates.
- #4 `a2355c1` **check**: Reject date windows longer than 500 days instead of loading their pages, apply the default value to negative numbers in the Sheet as well as blank or zero cells, and change the default number of adults from 2 to 1.
- #4 `9e607cd` **CI**: Upgrade Playwright to 1.64.1 and pin runners to `ubuntu-26.04`, so the browser install works again.
- #4 `7b24888` **check**: Send each child to Booking with an age of 13, since Booking requires an age to count a child as a guest. Ignore the query of the Sheet's property URL, so the guests of a pasted Booking search no longer replace the watchdog's. Reject property URLs that do not start with `https://www.booking.com/hotel/`, show an error message, and mark the workflow run as failed.
- #4 `7b24888` **check**: Use the property name from the URL, without its language code, as the title of every Slack message when the watchdog has no name, including error notifications. Set the Slack send timeout to 10 seconds instead of 5 minutes.
- #4 `7b24888` **check**: Validate guest counts in directly supplied watchdogs, rejecting values that aren't whole numbers, fewer than 1 adult and fewer than 0 children, with an error message and a failed workflow run instead of sending the request to Booking.
- #4 `26ebaab` **check**: Keep Sheet data out of public GitHub Actions logs, dry runs included. A workflow run shows only row numbers, counts and error names, such as `TypeError`. Name each check job by its row, such as `Check row 5`, and pass it only the row number, instead of uploading the watchdogs as an artifact that anyone signed in to GitHub could download. Slack messages keep the details, and a check outside CI still logs them. Add `WATCHDOG_ROW` to check one Sheet row outside CI. Show the cause of an error in its Slack message, such as why a fetch failed. Log that a Slack message was sent only after Slack accepts it.
- #4 `7d1e716` **check**: Send a new alert when an available stretch reappears, and consolidate daily alerts into a single alert for stretches that include today.

### CI

- #4 `be6c8ec` **deps**: Bump Node to 26.13.0, pnpm to 12.16.1, googleapis to 189.0.0, Biome to 2.6.4 and `@clack/prompts` to 1.8.1. Bump the GitHub Actions too: `checkout` 7.0.1, `setup-node` 7.1.0, `upload-artifact` 7.0.2 and `pnpm/action-setup` 6.1.0.



## v1.1.2

### Fixes

- `7cc7684` **CI**: Move run deletion to separate cleanup workflow.

### Tests

- `7cc7684` **CI**: Run integration test monthly with dynamic check-in and check-out dates.



## v1.1.1

### Fixes

- `5dc0433` **CI**: Grants `actions:write` to run delete in Check availability workflow.



## v1.1.0

### Features

- `d112485` **check**: Auto-delete successful workflow runs to keep logs private.
- `d112485` **check**: Randomize workflow run timing.



## v1.0.0

- `16a3f43` Initial release


