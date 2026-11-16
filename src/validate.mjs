/**
 * Fills in the values a watchdog leaves out, and rejects the ones the check
 * can't use. `runWatchdog` calls both before it chooses dates.
 */

import { isPropertyUrl, PROPERTY_URL_START } from './booking.mjs'
import {
	DEFAULT_ADULTS,
	DEFAULT_CHILDREN,
	DEFAULT_MIN_NIGHTS,
} from './constants.mjs'
import { daysBetween, isRealDate } from './dates.mjs'

/**
 * One row of the Sheet.
 *
 * @typedef {import('./watchdog.mjs').Watchdog} Watchdog
 */

/**
 * Longest window a watchdog may have, in days from start to end.
 *
 * Without a limit, a wrong year asks for thousands of pages. A window from
 * 2026-07-01 that ends in 2036 instead of 2026 asks for 3660 pages. By
 * estimate, that takes longer than the check job's `timeout-minutes: 15`.
 */
const MAX_WINDOW_DAYS = 500

/**
 * Fills in the guests and minimum nights when a watchdog leaves them out.
 *
 * Only a watchdog from `WATCHDOG_CONFIG` or a test leaves them out, because
 * `config.mjs` fills them in for every Sheet row. A `null` stays `null`, and
 * `validateWatchdog` rejects it.
 *
 * @param {Watchdog} watchdog
 * @returns {Watchdog} A copy with `adults`, `children` and `min_nights` set.
 */
export function withDefaults({
	adults = DEFAULT_ADULTS,
	children = DEFAULT_CHILDREN,
	min_nights = DEFAULT_MIN_NIGHTS,
	...rest
}) {
	return { ...rest, adults, children, min_nights }
}

/**
 * Throws for the first value of the watchdog that the check can't use, in this
 * order:
 *
 * 1. A property URL that doesn't start with `PROPERTY_URL_START`.
 * 2. An invalid window: reversed, with an impossible date, or longer than
 *    `MAX_WINDOW_DAYS`. A date not written as `YYYY-MM-DD` counts as
 *    impossible.
 * 3. Minimum nights that aren't a whole number of at least 1.
 * 4. Adults that aren't a whole number of at least 1, then children that
 *    aren't a whole number of at least 0.
 *
 * Only a watchdog from `WATCHDOG_CONFIG` or a test can fail 3 or 4, because
 * `config.mjs` gives a bad Sheet cell its default. `withDefaults` doesn't
 * replace `null`, so `null` gets the error too.
 *
 * `runWatchdog` calls it before it chooses dates, so a watchdog with a finished
 * window still gets the error. An invalid window isn't a finished window, even
 * when its dates are past.
 *
 * The messages hold no Sheet value. Slack and a verbose log show them, and the
 * public log shows only the error's name.
 *
 * @param {Watchdog} watchdog With `adults`, `children` and `min_nights` filled
 *   in.
 */
export function validateWatchdog({
	property_url,
	checkin_date,
	checkout_date,
	min_nights,
	adults,
	children,
}) {
	if (!isPropertyUrl(property_url)) {
		throw new Error(`The property URL must start with ${PROPERTY_URL_START}.`)
	}

	const isWindowValid =
		isRealDate(checkin_date) &&
		isRealDate(checkout_date) &&
		checkin_date <= checkout_date
	if (!isWindowValid) {
		throw new Error(
			'The window has an impossible date, or its start is after its end.',
		)
	}

	const isWindowTooLong =
		daysBetween(checkin_date, checkout_date) > MAX_WINDOW_DAYS
	if (isWindowTooLong) {
		throw new Error(`The window is longer than ${MAX_WINDOW_DAYS} days.`)
	}

	const isMinNightsValid = Number.isInteger(min_nights) && min_nights >= 1
	if (!isMinNightsValid) {
		throw new Error('The minimum nights must be a whole number of at least 1.')
	}

	const isAdultsValid = Number.isInteger(adults) && adults >= 1
	if (!isAdultsValid) {
		throw new Error(
			'The number of adults must be a whole number of at least 1.',
		)
	}

	const isChildrenValid = Number.isInteger(children) && children >= 0
	if (!isChildrenValid) {
		throw new Error(
			'The number of children must be a whole number of at least 0.',
		)
	}
}
