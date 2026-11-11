/**
 * Decides when unknown dates are too many. The scrape and `runWatchdog` share
 * the rule, so the second try and the unknown message can't disagree.
 *
 * The rule sits in its own module so neither of them loads the other. The
 * scrape needs no Slack, and the watchdog logic needs no Playwright.
 */

/**
 * Highest share of unknown dates, in percent, that still counts as a few.
 * Above it, Booking may block the scraper, or its page changed.
 */
const MAX_UNKNOWN_PERCENT = 10

/**
 * Tells whether more than `MAX_UNKNOWN_PERCENT` of the dates are unknown.
 * Exactly that share is not too many. One unknown date of 10 is fine. Two of
 * 19 are too many.
 *
 * @param {import('./watchdog.mjs').DateResult[]} dateResults One result per
 *   date of the window.
 * @returns {boolean} `true` for too many unknown dates.
 */
export function isTooManyUnknown(dateResults) {
	const unknownCount = dateResults.filter((d) => d.result === 'unknown').length
	// Whole numbers on both sides. 1 unknown of 10 compares 100 > 100, which is
	// false.
	return unknownCount * 100 > dateResults.length * MAX_UNKNOWN_PERCENT
}
