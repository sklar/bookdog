---
bump: patch
type: fix
scope: check
---
Send each child to Booking with an age of 13, since Booking requires an age to count a child as a guest. Ignore the query of the Sheet's property URL, so the guests of a pasted Booking search no longer replace the watchdog's. Reject property URLs that do not start with `https://www.booking.com/hotel/`, show an error message, and mark the workflow run as failed.