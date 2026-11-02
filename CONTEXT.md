# Bookdog

A watchdog for Booking.com availability. It tells its owner when a wanted property has free nights, and when it can no longer answer.

## Language

### What is watched

**Watchdog**:
One row of the Sheet: a property, a window, guests and minimum nights.
_Avoid_: job, config, entry

**Window**:
The dates a watchdog covers. A stay must fit inside it.
_Avoid_: range, period

**Stretch**:
Free nights in a sequence, at least as many as the watchdog's minimum nights.
_Avoid_: run

### What a date can be

**Available**:
Booking offers a room for a stay of the minimum nights from this date.

**Sold out**:
Booking confirms that a live property has no room for this date.
_Avoid_: no table, unavailable

**Unknown**:
The date has no answer, because its page failed or the page was not recognised.
_Avoid_: blocked, error, sold out

### What a property can be

**Missing**:
Booking has no page for the property any more and sends visitors elsewhere.
_Avoid_: delisted, gone, dead

### How it runs

**Workflow run**:
One execution on GitHub Actions, which covers all watchdogs.
_Avoid_: bare "run"
