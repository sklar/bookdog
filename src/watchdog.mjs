/**
 * Checks one watchdog. `runWatchdog` holds the steps. `check.mjs` passes in the
 * real scrape and state store, so this file loads neither Playwright nor
 * Google.
 */

import {
	DEFAULT_ADULTS,
	DEFAULT_CHILDREN,
	DEFAULT_MIN_NIGHTS,
} from './constants.mjs'
import { addDays, dateRange, daysBetween, isRealDate } from './dates.mjs'
import { sendAlert, sendError } from './slack.mjs'

/**
 * One row of the Sheet, as the CLI reads it from `WATCHDOG_CONFIG`.
 *
 * @typedef {object} Watchdog
 * @property {string} id Finds the watchdog's row in the state tab. Slack
 *   messages show it under the title.
 * @property {string} [name] Title of the Slack messages.
 * @property {string} property_url Booking page of the property.
 * @property {string} checkin_date Start of the window, `YYYY-MM-DD`.
 * @property {string} checkout_date End of the window, `YYYY-MM-DD`. It's a
 *   check-out date.
 * @property {number} [adults] Adults in each search. Defaults to
 *   `DEFAULT_ADULTS`.
 * @property {number} [children] Children in each search. Defaults to
 *   `DEFAULT_CHILDREN`.
 * @property {number} [min_nights] Length of the stay each check-in date asks
 *   about. Defaults to `DEFAULT_MIN_NIGHTS`. Anything but a whole number of at
 *   least 1 is an error.
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
 * What the scrape found for one check-in date.
 *
 * @typedef {object} DateResult
 * @property {string} date `YYYY-MM-DD`.
 * @property {boolean} available `true` when Booking offers a stay of the
 *   minimum nights from this date.
 */

/**
 * Asks Booking about each check-in date. The CLI passes `scrapeAvailability`,
 * and the tests pass a fake.
 *
 * @callback Scrape
 * @param {string} propertyUrl
 * @param {string[]} dates Check-in dates, `YYYY-MM-DD`.
 * @param {number} adults
 * @param {number} children
 * @param {number} minNights Length of the stay each date asks about.
 * @returns {Promise<DateResult[]>} One result for each date.
 */

/**
 * @typedef {import('./state.mjs').State} State
 */

/**
 * Keeps the alerted stretches between workflow runs. The CLI backs it with the
 * state tab of the Sheet.
 *
 * @typedef {object} StateStore
 * @property {(id: string) => Promise<State>} read Returns the state of one
 *   watchdog.
 * @property {(id: string, state: State) => Promise<void>} write Saves the
 *   state. Pass a copy of what `read` returned, with new `alertedStretches`.
 *   The copy keeps `rowIndex`, so the write updates the watchdog's own row.
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
 * Finds each stretch. An available date means Booking offers a stay of
 * `minNights` from that date, so one is enough. Any date that isn't available
 * ends the sequence.
 *
 * With a minimum of 3 and free nights Jul 10 to 14, the check-ins of Jul 10, 11
 * and 12 are available. That gives Jul 10 to Jul 15, 5 nights.
 *
 * @param {DateResult[]} availability Check-in dates in any order, with no date
 *   left out. A date that's left out doesn't end the sequence.
 * @param {number} minNights Length of the stay each date proves.
 * @returns {Stretch[]} Stretches in date order.
 */
export function findStretches(availability, minNights) {
	const sorted = [...availability].sort((a, b) => a.date.localeCompare(b.date))
	const sequences = []
	let sequence = null

	for (const { date, available } of sorted) {
		if (!available) {
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
 * its Slack message. They match when `start` and `end` are both equal.
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
 * Keeps the stretches that had no Slack message yet. `isSameStretch` decides
 * whether an alerted stretch matches.
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

/**
 * Longest window a watchdog may have, in days from start to end.
 *
 * Without a limit, a wrong year asks for thousands of pages. A window from
 * 2026-07-01 that ends in 2036 instead of 2026 asks for 3660. By estimate, that
 * takes longer than the job limit of 15 minutes.
 */
const MAX_WINDOW_DAYS = 500

/**
 * Lists the check-in dates that can still give a stay inside the window. The
 * first is the later of `start` and `today`. The last is `end` minus
 * `minNights`.
 *
 * Throws for an invalid window, which is reversed, has an impossible date or is
 * longer than `MAX_WINDOW_DAYS`. A date not written as `YYYY-MM-DD` counts as
 * impossible. An invalid window isn't a finished window, even when its dates
 * are past.
 *
 * Also throws when `minNights` isn't a whole number of at least 1. With several
 * problems, the first in this order decides the message.
 *
 * @param {string} start Start of the window, `YYYY-MM-DD`.
 * @param {string} end End of the window, `YYYY-MM-DD`. It's a check-out date.
 * @param {string} today `YYYY-MM-DD`.
 * @param {number} minNights Length of the stay each check-in date asks about.
 * @returns {string[]} The check-in dates in order, `YYYY-MM-DD`. Empty when the
 *   window is finished.
 */
function chooseCheckIns(start, end, today, minNights) {
	// These messages hold no dates or Sheet values, because error messages reach
	// the public log
	const isWindowValid = isRealDate(start) && isRealDate(end) && start <= end
	if (!isWindowValid) {
		throw new Error(
			'The window has an impossible date, or its start is after its end.',
		)
	}

	const isWindowTooLong = daysBetween(start, end) > MAX_WINDOW_DAYS
	if (isWindowTooLong) {
		throw new Error(`The window is longer than ${MAX_WINDOW_DAYS} days.`)
	}

	const isMinNightsValid = Number.isInteger(minNights) && minNights >= 1
	if (!isMinNightsValid) {
		throw new Error('The minimum nights must be a whole number of at least 1.')
	}

	const isTodayAfterStart = today > start
	const firstCheckIn = isTodayAfterStart ? today : start
	return dateRange(firstCheckIn, addDays(end, -minNights))
}

/**
 * Checks one watchdog, in this order:
 *
 * 1. Choose dates. With none left, stop and return `green`.
 * 2. Scrape.
 * 3. Find stretches.
 * 4. Dedup against the alerted stretches in state.
 * 5. Send one Slack message for the new stretches, if any.
 * 6. Write state, even with no stretches. The current stretches replace the
 *    alerted ones. A stretch that went away leaves state, so it gets a new
 *    Slack message when it comes back.
 *
 * An error in any step sends the Slack error message and returns `red`. A dry
 * run still scrapes and reads state, but it sends nothing and writes nothing.
 *
 * @param {object} options
 * @param {Watchdog} options.watchdog
 * @param {string} options.today `YYYY-MM-DD`. The CLI passes today in UTC.
 * @param {Scrape} options.scrape
 * @param {StateStore | null} options.stateStore `null` keeps no state, so each
 *   check treats every stretch as new.
 * @param {string} options.webhookUrl Slack webhook. An empty string prints the
 *   messages instead.
 * @param {boolean} options.isDryRun `true` skips Slack and state writes.
 * @returns {Promise<'red' | 'green'>} `red` when an error stopped the check,
 *   otherwise `green`.
 */
export async function runWatchdog({
	watchdog,
	today,
	scrape,
	stateStore,
	webhookUrl,
	isDryRun,
}) {
	const {
		id,
		name,
		property_url,
		checkin_date,
		checkout_date,
		adults = DEFAULT_ADULTS,
		children = DEFAULT_CHILDREN,
		min_nights = DEFAULT_MIN_NIGHTS,
	} = watchdog

	console.log(`🐶 Bookdog — ${id}`)
	console.log(`   Property: ${property_url}`)
	console.log(`   Dates: ${checkin_date} → ${checkout_date}`)
	console.log(
		`   Min nights: ${min_nights} | Adults: ${adults} | Children: ${children}`,
	)

	try {
		const checkIns = chooseCheckIns(
			checkin_date,
			checkout_date,
			today,
			min_nights,
		)
		if (checkIns.length === 0) {
			console.log('   Window finished, no dates to check.')
			return 'green'
		}

		const availability = await scrape(
			property_url,
			checkIns,
			adults,
			children,
			min_nights,
		)
		const availCount = availability.filter((d) => d.available).length
		console.log(`   Available dates: ${availCount}/${availability.length}`)

		const stretches = findStretches(availability, min_nights)
		console.log(`   Stretches found: ${stretches.length}`)

		const state = stateStore ? await stateStore.read(id) : null
		const alertedStretches = state ? state.alertedStretches : []
		const newStretches = deduplicateStretches(
			stretches,
			alertedStretches,
			today,
		)

		if (stretches.length === 0) {
			console.log('   No stretches found.')
		} else if (newStretches.length === 0) {
			console.log('   All stretches already alerted.')
		} else if (isDryRun) {
			console.log('[DRY RUN] Would send alert:')
			for (const stretch of newStretches) {
				console.log(
					`  ✅ ${stretch.start} → ${stretch.end} (${stretch.nights} nights)`,
				)
			}
		} else {
			await sendAlert(
				webhookUrl,
				id,
				name,
				property_url,
				newStretches,
				adults,
				children,
			)
			console.log('   Slack alert sent!')
		}

		const shouldWriteState = stateStore && !isDryRun
		if (!shouldWriteState) return 'green'

		await stateStore.write(id, { ...state, alertedStretches: stretches })
		console.log('   State updated.')
		return 'green'
	} catch (err) {
		console.error(`Error: ${err.message}`)
		if (!isDryRun) {
			// Slack may be what failed. The result is `red` either way, so a second
			// failure changes nothing.
			await sendError(webhookUrl, id, name, err.message).catch(() => {})
		}
		return 'red'
	}
}
