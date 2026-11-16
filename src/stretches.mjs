/**
 * Finds the stretches in the date results, and keeps the ones that had no
 * Slack message yet. `runWatchdog` calls both, and neither needs Playwright,
 * Slack or the Sheet.
 */

import { sortByDate } from './date-results.mjs'
import { addDays, daysBetween } from './dates.mjs'

/**
 * What the scrape found for one check-in date.
 *
 * @typedef {import('./date-results.mjs').DateResult} DateResult
 */

/**
 * Free nights in a sequence, at least as many as the watchdog's minimum nights.
 *
 * @typedef {object} Stretch
 * @property {string} start First night.
 * @property {string} end Check-out date, which is the last available check-in
 *   plus the minimum nights.
 * @property {number} nights Days from `start` to `end`.
 */

/**
 * Builds the stretch that a sequence of available check-in dates proves.
 *
 * @param {string[]} checkIns Available dates in order, `YYYY-MM-DD`.
 * @param {number} minNights Length of the stay each date proves.
 * @returns {Stretch} The stretch.
 */
function toStretch(checkIns, minNights) {
	const start = checkIns[0]
	const end = addDays(checkIns.at(-1), minNights)
	return { start, end, nights: daysBetween(start, end) }
}

/**
 * Finds the stretches in the date results.
 *
 * An available date means Booking offers a stay of `minNights` from that date,
 * so one available date already makes a stretch. A sold out or unknown date
 * ends the sequence, so no stretch holds a night that nobody verified.
 *
 * With a minimum of 3 and free nights Jul 10 to 14, the check-ins of Jul 10, 11
 * and 12 are available. That gives Jul 10 to Jul 15, 5 nights.
 *
 * @param {DateResult[]} dateResults Check-in dates in any order, with no date
 *   left out. A date that's left out doesn't end the sequence, so the gap
 *   joins the stretches on either side.
 * @param {number} minNights Length of the stay each date proves.
 * @returns {Stretch[]} Stretches in date order.
 */
export function findStretches(dateResults, minNights) {
	const sequences = []
	let sequence = null

	for (const { date, result } of sortByDate(dateResults)) {
		if (result !== 'available') {
			sequence = null
			continue
		}
		if (!sequence) {
			sequence = []
			sequences.push(sequence)
		}
		sequence.push(date)
	}

	return sequences.map((checkIns) => toStretch(checkIns, minNights))
}

/**
 * Tells whether `current` is the same stretch as `alerted`, which already had
 * its Slack message.
 *
 * They match when `start` and `end` are both equal.
 *
 * A stretch that includes today needs one more rule. It starts today, because
 * the first check-in is never before today, so its `start` moves forward each
 * day. It matches on the same `end` when both starts are today or earlier. A
 * stretch alerted on Jul 2 as Jul 2 to Jul 20 shows up on Jul 3 as Jul 3 to
 * Jul 20, and matches.
 *
 * A different `start` after today means a new stretch. On Jul 1, Jul 11 to
 * Jul 15 doesn't match an alerted Jul 10 to Jul 15, because Jul 10 is no longer
 * available.
 *
 * @param {Stretch} current Stretch found by this check.
 * @param {Stretch} alerted Stretch from state.
 * @param {string} today `YYYY-MM-DD`.
 * @returns {boolean} `true` when both are the same stretch.
 */
function isSameStretch(current, alerted, today) {
	if (current.end !== alerted.end) return false
	if (current.start === alerted.start) return true

	const isBothStartedByToday = current.start <= today && alerted.start <= today
	return isBothStartedByToday
}

/**
 * Keeps the stretches that had no Slack message yet.
 *
 * `isSameStretch` decides whether an alerted stretch matches.
 *
 * @param {Stretch[]} currentStretches Stretches found by this check.
 * @param {Stretch[]} alertedStretches Stretches from state, which already had
 *   their Slack message.
 * @param {string} today `YYYY-MM-DD`. A stretch that includes today starts on
 *   this date.
 * @returns {Stretch[]} The new stretches, in their order in
 *   `currentStretches`.
 */
export function deduplicateStretches(
	currentStretches,
	alertedStretches,
	today,
) {
	return currentStretches.filter(
		(current) =>
			!alertedStretches.some((alerted) =>
				isSameStretch(current, alerted, today),
			),
	)
}
