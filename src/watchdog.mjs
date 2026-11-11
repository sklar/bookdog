/**
 * Checks one watchdog. `runWatchdog` holds the steps.
 *
 * `check.mjs` passes in the real scrape and state store, so this file loads
 * neither Playwright nor Google. The tests pass fakes instead.
 */

import { isPropertyUrl, PROPERTY_URL_START } from './booking.mjs'
import {
	DEFAULT_ADULTS,
	DEFAULT_CHILDREN,
	DEFAULT_MIN_NIGHTS,
} from './constants.mjs'
import { addDays, dateRange, daysBetween, isRealDate } from './dates.mjs'
import { sendError, sendMissing, sendStretches, sendUnknown } from './slack.mjs'
import { isTooManyUnknown } from './unknown-dates.mjs'

/**
 * One row of the Sheet, as the CLI reads it from `WATCHDOG_CONFIG`.
 *
 * @typedef {object} Watchdog
 * @property {string} id Finds the watchdog's row in the state tab. Slack
 *   messages show it under the title.
 * @property {string} [name] Title of the Slack messages. Without one, the
 *   messages take a title from `property_url`.
 * @property {string} property_url Booking page of the property. It must start
 *   with `PROPERTY_URL_START`. Its query doesn't reach Booking, so guests from
 *   a pasted search URL have no effect.
 * @property {string} checkin_date Start of the window, `YYYY-MM-DD`.
 * @property {string} checkout_date End of the window, `YYYY-MM-DD`. It's a
 *   check-out date.
 * @property {number} [adults] Adults in each search. Defaults to
 *   `DEFAULT_ADULTS`. Anything but a whole number of at least 1 is an error.
 * @property {number} [children] Children in each search, each aged
 *   `CHILD_AGE`. Defaults to `DEFAULT_CHILDREN`. Anything but a whole number of
 *   at least 0 is an error.
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
 * What the scrape found.
 *
 * The property is missing when Booking sent the first date's page outside
 * `/hotel/`. The scrape then stops after that one page, so a missing result
 * has no date results.
 *
 * @typedef {{ missing: true, finalUrl: string }
 *   | { missing: false, dateResults: DateResult[] }} ScrapeResult
 */

/**
 * Asks Booking about each check-in date. The CLI passes `scrapeAvailability`,
 * and the tests pass a fake.
 *
 * @callback Scrape
 * @param {Watchdog} watchdog With `adults`, `children` and `min_nights` filled
 *   in. Each date asks for a stay of `min_nights`.
 * @param {string[]} dates Check-in dates, `YYYY-MM-DD`. At least one.
 * @returns {Promise<ScrapeResult>} Missing with the final URL, or one result
 *   for each date.
 */

/**
 * One watchdog's row in the `state` tab, with its alerted stretches.
 *
 * @typedef {import('./state.mjs').State} State
 */

/**
 * Keeps the alerted stretches between workflow runs.
 *
 * The CLI reads and writes the `state` tab of the Sheet through it. The tests
 * keep the state in memory.
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
	const sorted = [...dateResults].sort((a, b) => a.date.localeCompare(b.date))
	const sequences = []
	let sequence = null

	for (const { date, result } of sorted) {
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
 * 2026-07-01 that ends in 2036 instead of 2026 asks for 3660 pages. By
 * estimate, that takes longer than the job limit of 15 minutes.
 */
const MAX_WINDOW_DAYS = 500

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
 * Only a watchdog passed in directly can fail 3 or 4, because `config.mjs`
 * gives a bad Sheet cell its default. `withDefaults` doesn't replace `null`, so
 * `null` gets the error too.
 *
 * `runWatchdog` calls it before it chooses dates, so a watchdog with a finished
 * window still gets the error. An invalid window isn't a finished window, even
 * when its dates are past.
 *
 * The messages hold no Sheet value, because error messages reach the public
 * log.
 *
 * @param {Watchdog} watchdog With `adults`, `children` and `min_nights` filled
 *   in.
 */
function validateWatchdog({
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

/**
 * Lists the check-in dates that can still give a stay inside the window.
 *
 * The first is the later of `start` and `today`. The last is `end` minus
 * `minNights`. With Jul 1 to Jul 10 and a minimum of 3, the last is Jul 7.
 *
 * Expects values that passed `validateWatchdog`.
 *
 * @param {string} start Start of the window, `YYYY-MM-DD`.
 * @param {string} end End of the window, `YYYY-MM-DD`. It's a check-out date.
 * @param {string} today `YYYY-MM-DD`.
 * @param {number} minNights Length of the stay each check-in date asks about.
 * @returns {string[]} The check-in dates in order, `YYYY-MM-DD`. Empty when the
 *   window is finished.
 */
function chooseCheckIns(start, end, today, minNights) {
	const isTodayAfterStart = today > start
	const firstCheckIn = isTodayAfterStart ? today : start
	return dateRange(firstCheckIn, addDays(end, -minNights))
}

/**
 * Fills in the guests and minimum nights when a watchdog leaves them out.
 *
 * Only a watchdog passed in directly can, because `config.mjs` fills them in
 * for every Sheet row. A `null` stays `null`, and `validateWatchdog` rejects
 * it.
 *
 * @param {Watchdog} watchdog
 * @returns {Watchdog} A copy with `adults`, `children` and `min_nights` set.
 */
function withDefaults({
	adults = DEFAULT_ADULTS,
	children = DEFAULT_CHILDREN,
	min_nights = DEFAULT_MIN_NIGHTS,
	...rest
}) {
	return { ...rest, adults, children, min_nights }
}

/**
 * Checks one watchdog, in this order:
 *
 * 1. Validate the watchdog, then choose dates. With no dates left, stop and
 *    return `green`.
 * 2. Scrape.
 * 3. If the property is missing, send the missing message and return `red`.
 *    State stays as it is, so the message stops by itself once Booking lists
 *    the property again.
 * 4. Find stretches.
 * 5. Keep the stretches that aren't among the alerted stretches in state.
 * 6. Send one Slack message for the new stretches, if any.
 * 7. If `isTooManyUnknown` finds more than 10% of the dates unknown, send the
 *    unknown message. The check returns `red`, after step 8.
 * 8. Write state, even with no stretches. The current stretches replace the
 *    alerted ones. A stretch that went away leaves state, so it gets a new
 *    Slack message when it comes back.
 *
 *    With too many unknown dates, the alerted stretches stay and the new ones
 *    join them, because the unknown dates may hide a stretch that is still
 *    there.
 *
 *    If this write fails after step 6 sent its message, the next workflow run
 *    sends the same stretches again. A failed unknown message in step 7 does
 *    the same, because the error skips this write. A repeated message is
 *    better than a missed one.
 *
 * An error in any step sends the Slack error message and returns `red`.
 *
 * A dry run still scrapes, and reads state if it gets to step 5, but it sends
 * nothing and writes nothing. It returns the same colour as without the dry
 * run.
 *
 * @param {object} options
 * @param {Watchdog} options.watchdog One row of the Sheet. `withDefaults` fills
 *   in what it leaves out.
 * @param {string} options.today `YYYY-MM-DD`. The CLI passes today in UTC.
 * @param {Scrape} options.scrape `scrapeAvailability`, or a fake in the tests.
 * @param {StateStore | null} options.stateStore `null` keeps no state, so each
 *   check treats every stretch as new.
 * @param {string} options.webhookUrl Slack webhook. An empty string prints the
 *   messages instead.
 * @param {string | null} options.workflowRunUrl Link to the workflow run, for
 *   the unknown message. `null` on the owner's machine, which leaves the link
 *   out.
 * @param {boolean} options.isDryRun `true` skips Slack and state writes.
 * @returns {Promise<'red' | 'green'>} `red` when an error stopped the check,
 *   the property is missing or too many dates are unknown, otherwise `green`.
 */
export async function runWatchdog({
	watchdog: givenWatchdog,
	today,
	scrape,
	stateStore,
	webhookUrl,
	workflowRunUrl,
	isDryRun,
}) {
	const watchdog = withDefaults(givenWatchdog)
	const {
		id,
		property_url,
		checkin_date,
		checkout_date,
		adults,
		children,
		min_nights,
	} = watchdog

	console.log(`🐶 Bookdog — ${id}`)
	console.log(`   Property: ${property_url}`)
	console.log(`   Dates: ${checkin_date} → ${checkout_date}`)
	console.log(
		`   Min nights: ${min_nights} | Adults: ${adults} | Children: ${children}`,
	)

	try {
		validateWatchdog(watchdog)
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

		const scrapeResult = await scrape(watchdog, checkIns)
		if (scrapeResult.missing) {
			const { finalUrl } = scrapeResult
			console.log(`   Property missing. Booking sends visitors to ${finalUrl}`)
			if (isDryRun) {
				console.log('[DRY RUN] Would send the missing message.')
			} else {
				await sendMissing(webhookUrl, watchdog, finalUrl)
			}
			return 'red'
		}

		const { dateResults } = scrapeResult
		const count = (result) =>
			dateResults.filter((d) => d.result === result).length
		console.log(
			`   Dates checked: ${dateResults.length} — ${count('available')} available, ${count('sold-out')} sold out, ${count('unknown')} unknown`,
		)

		const stretches = findStretches(dateResults, min_nights)
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
			await sendStretches(webhookUrl, watchdog, newStretches)
			console.log('   Slack alert sent!')
		}

		const hasTooManyUnknown = isTooManyUnknown(dateResults)
		if (hasTooManyUnknown) {
			const counts = { unknown: count('unknown'), total: dateResults.length }
			console.log(
				`   Too many unknown dates: ${counts.unknown} of ${counts.total}.`,
			)
			if (isDryRun) {
				console.log('[DRY RUN] Would send the unknown message.')
			} else {
				await sendUnknown(webhookUrl, watchdog, counts, workflowRunUrl)
			}
		}
		const colour = hasTooManyUnknown ? 'red' : 'green'

		const shouldWriteState = stateStore && !isDryRun
		if (!shouldWriteState) return colour

		// Too many unknown dates can hide an alerted stretch. Dropping it from
		// state would repeat its message once the dates have answers again.
		const nextAlertedStretches = hasTooManyUnknown
			? [...alertedStretches, ...newStretches]
			: stretches
		await stateStore.write(id, {
			...state,
			alertedStretches: nextAlertedStretches,
		})
		console.log('   State updated.')
		return colour
	} catch (err) {
		console.error(`Error: ${err.message}`)
		if (!isDryRun) await sendError(webhookUrl, watchdog, err.message)
		return 'red'
	}
}
