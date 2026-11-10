---
bump: patch
type: fix
scope: check
---
Load all property pages in English to avoid counting unavailable rooms as available on localized pages (e.g. `.de.html` URLs), read dates immediately when Booking displays its no-availability message instead of waiting 5 seconds, and send Booking the user agent of the Chrome version that runs.