---
bump: patch
type: fix
scope: check
---
Validate guest counts in directly supplied watchdogs, rejecting values that aren't whole numbers, fewer than 1 adult and fewer than 0 children, with an error message and a failed workflow run instead of sending the request to Booking.