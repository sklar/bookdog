/**
 * Date results and the rules about them. The scrape and `runWatchdog` share
 * them, so the second try and the unknown message can't disagree.
 *
 * The rules sit in their own module so neither of them loads the other. The
 * scrape needs no Slack, and the watchdog logic needs no Playwright.
 */

/**
 * What the scrape found for one check-in date:
 *
 * - `available`: Booking offers a stay of the minimum nights from this date.
 * - `sold-out`: the property page proves that it has no room for that stay.
 * - `unknown`: the page failed, or the scraper didn't recognise it.
 *
 * @typedef {object} DateResult
 * @property {string} date `YYYY-MM-DD`.
 * @property {'available' | 'sold-out' | 'unknown'} result
 */

/**
 * Highest share of unknown dates, in percent, that still counts as a few.
 * Above it, Booking may block the scraper, or its page changed.
 */
const MAX_UNKNOWN_PERCENT = 10

/**
 * Sorts date results by date.
 *
 * @param {DateResult[]} dateResults
 * @returns {DateResult[]} A sorted copy.
 */
export function sortByDate(dateResults) {
	return dateResults.toSorted((a, b) => a.date.localeCompare(b.date))
}

/**
 * Lists the dates that have one result.
 *
 * @param {DateResult[]} dateResults
 * @param {DateResult['result']} result Such as `unknown`.
 * @returns {string[]} The dates with that result, in the order of
 *   `dateResults`.
 */
export function datesWith(dateResults, result) {
	return dateResults.filter((d) => d.result === result).map((d) => d.date)
}

/**
 * Tells whether more than `MAX_UNKNOWN_PERCENT` of the dates are unknown.
 * Exactly that share is not too many. One unknown date of 10 is fine. Two of
 * 19 are too many.
 *
 * @param {DateResult[]} dateResults One result per date of the window.
 * @returns {boolean} `true` for too many unknown dates.
 */
export function isTooManyUnknown(dateResults) {
	const unknownCount = datesWith(dateResults, 'unknown').length
	// Whole numbers on both sides. 1 unknown of 10 compares 100 > 100, which is
	// false.
	return unknownCount * 100 > dateResults.length * MAX_UNKNOWN_PERCENT
}
