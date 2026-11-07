/**
 * Works with dates as `YYYY-MM-DD` text, the form they take in the Sheet, the
 * state tab and Booking URLs. `scraper.mjs` and `watchdog.mjs` both use it.
 */

/**
 * Moves a date forward or back by a number of days.
 *
 * `Temporal.PlainDate` holds no time or time zone, so a clock change can't skip
 * or repeat a date.
 *
 * Throws a `RangeError` for an impossible date such as `2026-02-30`.
 *
 * @param {string} date `YYYY-MM-DD`.
 * @param {number} days Days to add. A negative number moves back.
 * @returns {string} The new date, `YYYY-MM-DD`.
 */
export function addDays(date, days) {
	return Temporal.PlainDate.from(date).add({ days }).toString()
}

/**
 * Counts the days from one date to another.
 *
 * @param {string} start `YYYY-MM-DD`.
 * @param {string} end `YYYY-MM-DD`.
 * @returns {number} The days. Negative when `end` is before `start`.
 */
export function daysBetween(start, end) {
	return Temporal.PlainDate.from(start).until(end).days
}

/**
 * Lists each date from `start` to `end`, both included. The list is empty when
 * `start` is after `end`.
 *
 * @param {string} start First date, `YYYY-MM-DD`.
 * @param {string} end Last date, `YYYY-MM-DD`.
 * @returns {string[]} The dates in order, `YYYY-MM-DD`.
 */
export function dateRange(start, end) {
	const dates = []
	for (let date = start; date <= end; date = addDays(date, 1)) {
		dates.push(date)
	}
	return dates
}

/**
 * Says whether `text` is a date that exists, written as `YYYY-MM-DD`.
 * `Temporal.PlainDate.from` accepts other formats such as `20260701`, so the
 * format gets its own check.
 *
 * @param {string} text Date from the Sheet.
 * @returns {boolean} `true` for a real date written as `YYYY-MM-DD`.
 */
export function isRealDate(text) {
	const isIsoFormat = /^\d{4}-\d{2}-\d{2}$/.test(text)
	if (!isIsoFormat) return false

	try {
		Temporal.PlainDate.from(text)
		return true
	} catch {
		return false
	}
}
