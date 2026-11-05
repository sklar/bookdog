/**
 * Date arithmetic on `YYYY-MM-DD` text, the form dates take in the Sheet, the
 * state tab and Booking URLs. It lives apart from `check.mjs`, because that
 * file imports the modules that need it.
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
