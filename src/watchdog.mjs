/**
 * Checks one watchdog. `runWatchdog` holds the steps.
 *
 * `check.mjs` passes in the real scrape and state store, so this file loads
 * neither Playwright nor Google. The tests pass fakes instead.
 *
 * Every line goes through the logger that `check.mjs` passes in. On GitHub it
 * prints only counts and fixed text, and Slack gets the detail.
 */

import { isPropertyUrl, PROPERTY_URL_START } from './booking.mjs'
import {
	DEFAULT_ADULTS,
	DEFAULT_CHILDREN,
	DEFAULT_MIN_NIGHTS,
} from './constants.mjs'
import { datesWith, isTooManyUnknown } from './date-results.mjs'
import { addDays, dateRange, daysBetween, isRealDate } from './dates.mjs'
import { describeError } from './logger.mjs'
import { sendError, sendMissing, sendStretches, sendUnknown } from './slack.mjs'
import { deduplicateStretches, findStretches } from './stretches.mjs'

/**
 * One row of the Sheet.
 *
 * The CLI reads it from the row in `WATCHDOG_ROW`, or from the JSON in
 * `WATCHDOG_CONFIG`.
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
 * What the scrape found for one check-in date.
 *
 * @typedef {import('./date-results.mjs').DateResult} DateResult
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
 * Asks Booking about each check-in date.
 *
 * The CLI passes `scrapeAvailability`, and the tests pass a fake.
 *
 * @callback Scrape
 * @param {Watchdog} watchdog With `adults`, `children` and `min_nights` filled
 *   in. Each date asks for a stay of `min_nights`.
 * @param {string[]} dates Check-in dates, `YYYY-MM-DD`. At least one.
 * @param {Logger} logger Prints the scrape's lines.
 * @returns {Promise<ScrapeResult>} Missing with the final URL, or one result
 *   for each date.
 */

/**
 * One watchdog's row in the `state` tab, with its alerted stretches.
 *
 * @typedef {import('./state.mjs').State} State
 */

/**
 * Prints the lines of a check, with Sheet data only when verbose.
 *
 * @typedef {import('./logger.mjs').Logger} Logger
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
 * Longest window a watchdog may have, in days from start to end.
 *
 * Without a limit, a wrong year asks for thousands of pages. A window from
 * 2026-07-01 that ends in 2036 instead of 2026 asks for 3660 pages. By
 * estimate, that takes longer than the check job's `timeout-minutes: 15`.
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
 * Only a watchdog from `WATCHDOG_CONFIG` or a test can fail 3 or 4, because
 * `config.mjs` gives a bad Sheet cell its default. `withDefaults` doesn't replace `null`, so
 * `null` gets the error too.
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
 * Only a watchdog from `WATCHDOG_CONFIG` or a test leaves them out, because
 * `config.mjs` fills them in for every Sheet row. A `null` stays `null`, and
 * `validateWatchdog` rejects it.
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
 * 7. If `isTooManyUnknown` finds more than `MAX_UNKNOWN_PERCENT` of the dates
 *    unknown, send the unknown message. The check returns `red`, after step 8.
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
 * nothing and writes nothing. For each message it skips, it logs a line such
 * as `[DRY RUN] Would send the error message.` It returns the same colour as
 * without the dry run.
 *
 * @param {object} options
 * @param {Watchdog} options.watchdog One row of the Sheet. `withDefaults` fills
 *   in what it leaves out.
 * @param {string} options.today `YYYY-MM-DD`. The CLI passes today in UTC.
 * @param {Scrape} options.scrape `scrapeAvailability`, or a fake in the tests.
 * @param {StateStore | null} options.stateStore `null` keeps no state, so each
 *   check treats every stretch as new.
 * @param {string} options.webhookUrl Slack webhook. An empty string sends
 *   nothing, and a verbose logger prints the messages instead.
 * @param {string | null} options.workflowRunUrl Link to the workflow run, for
 *   the message about too many unknown dates. `null` on the owner's machine,
 *   which leaves the link out.
 * @param {boolean} options.isDryRun `true` skips Slack and state writes.
 * @param {Logger} options.logger Prints the counts and steps of the check. A
 *   verbose logger also prints the watchdog's id, URL, window and guests, the
 *   new stretches of a dry run, where a missing property's page goes, and each
 *   error message. On GitHub an error shows only its name.
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
	logger,
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

	/**
	 * Sends one Slack message, or on a dry run logs that it would.
	 *
	 * The missing, unknown and error messages go through it. The stretch
	 * message has its own dry run branch, which also lists each new stretch in
	 * the verbose log.
	 *
	 * @param {string} name The message, as the log names it, such as `missing`.
	 * @param {() => Promise<void>} send Sends the message.
	 * @returns {Promise<void>} Resolves after the send, or at once on a dry run.
	 */
	const sendUnlessDryRun = async (name, send) => {
		if (isDryRun) {
			logger.log(`[DRY RUN] Would send the ${name} message.`)
			return
		}
		await send()
	}

	logger.detail(`   Watchdog: ${id}`)
	logger.detail(`   Property: ${property_url}`)
	logger.detail(`   Dates: ${checkin_date} → ${checkout_date}`)
	logger.detail(
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
			logger.log('   Window finished, no dates to check.')
			return 'green'
		}

		const scrapeResult = await scrape(watchdog, checkIns, logger)
		if (scrapeResult.missing) {
			const { finalUrl } = scrapeResult
			logger.log('   Property missing.')
			logger.detail(`   Booking sends visitors to ${finalUrl}`)
			await sendUnlessDryRun('missing', () =>
				sendMissing(webhookUrl, watchdog, finalUrl, logger),
			)
			return 'red'
		}

		const { dateResults } = scrapeResult
		const count = (result) => datesWith(dateResults, result).length
		logger.log(
			`   Dates checked: ${dateResults.length} — ${count('available')} available, ${count('sold-out')} sold out, ${count('unknown')} unknown`,
		)

		const stretches = findStretches(dateResults, min_nights)
		logger.log(`   Stretches found: ${stretches.length}`)

		const state = stateStore ? await stateStore.read(id) : null
		const alertedStretches = state ? state.alertedStretches : []
		const newStretches = deduplicateStretches(
			stretches,
			alertedStretches,
			today,
		)

		// "Stretches found: 0" already says that there's nothing to send
		const hasNewStretches = newStretches.length > 0
		const isEveryStretchAlerted = stretches.length > 0 && !hasNewStretches
		if (isEveryStretchAlerted) {
			logger.log('   All stretches already alerted.')
		} else if (hasNewStretches && isDryRun) {
			logger.log('[DRY RUN] Would send the stretch message.')
			for (const stretch of newStretches) {
				logger.detail(
					`  ✅ ${stretch.start} → ${stretch.end} (${stretch.nights} nights)`,
				)
			}
		} else if (hasNewStretches) {
			await sendStretches(webhookUrl, watchdog, newStretches, logger)
		}

		const hasTooManyUnknown = isTooManyUnknown(dateResults)
		if (hasTooManyUnknown) {
			const counts = { unknown: count('unknown'), total: dateResults.length }
			logger.log(
				`   Too many unknown dates: ${counts.unknown} of ${counts.total}.`,
			)
			await sendUnlessDryRun('unknown', () =>
				sendUnknown(webhookUrl, watchdog, counts, workflowRunUrl, logger),
			)
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
		logger.log('   State updated.')
		return colour
	} catch (err) {
		logger.error('Check failed', err)
		await sendUnlessDryRun('error', () =>
			sendError(webhookUrl, watchdog, describeError(err), logger),
		)
		return 'red'
	}
}
