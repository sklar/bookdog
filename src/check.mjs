/**
 * Checks one watchdog. `runWatchdog` holds the logic, and the CLI block at the
 * bottom wires in the real scrape, Sheet and Slack.
 */

import { getAuth } from './config.mjs'
import { addDays, daysBetween } from './dates.mjs'
import { scrapeAvailability } from './scraper.mjs'
import { sendAlert, sendError } from './slack.mjs'
import { readState, writeState } from './state.mjs'

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
 * @property {number} [adults] Defaults to 2.
 * @property {number} [children] Defaults to 0.
 * @property {number} [min_nights] Length of the stay each check-in date asks
 *   about. Defaults to 3.
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
 *   state. It takes the object `read` returned, because that object holds the
 *   Sheet row.
 */

/**
 * Builds the stretch that a sequence of available check-in dates proves.
 *
 * @param {string} firstCheckIn First available date, `YYYY-MM-DD`.
 * @param {string} lastCheckIn Last available date, `YYYY-MM-DD`.
 * @param {number} minNights Length of the stay each date proves.
 * @returns {Stretch} The stretch.
 */
function toStretch(firstCheckIn, lastCheckIn, minNights) {
	const end = addDays(lastCheckIn, minNights)
	return { start: firstCheckIn, end, nights: daysBetween(firstCheckIn, end) }
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
	const stretches = []
	let firstCheckIn = null
	let lastCheckIn = null

	for (const { date, available } of sorted) {
		if (available) {
			firstCheckIn ??= date
			lastCheckIn = date
			continue
		}
		if (firstCheckIn) {
			stretches.push(toStretch(firstCheckIn, lastCheckIn, minNights))
		}
		firstCheckIn = null
	}

	// A stretch can reach the last date, so no later date closes it
	if (firstCheckIn) {
		stretches.push(toStretch(firstCheckIn, lastCheckIn, minNights))
	}

	return stretches
}

/**
 * Keeps the stretches that have no alert yet. An alerted stretch matches when
 * `start` and `end` are both equal.
 *
 * @param {Stretch[]} currentStretches Stretches found by this check.
 * @param {Stretch[]} alertedStretches Stretches from state, which already had
 *   an alert.
 * @returns {Stretch[]} The new stretches.
 */
export function deduplicateStretches(currentStretches, alertedStretches) {
	return currentStretches.filter(
		(stretch) =>
			!alertedStretches.some(
				(a) => a.start === stretch.start && a.end === stretch.end,
			),
	)
}

/**
 * Lists each date from `start` to `end`, both included. The list is empty when
 * `start` is after `end`.
 *
 * @param {string} start First date, `YYYY-MM-DD`.
 * @param {string} end Last date, `YYYY-MM-DD`.
 * @returns {string[]} The dates in order, `YYYY-MM-DD`.
 */
function dateRange(start, end) {
	const dates = []
	for (let date = start; date <= end; date = addDays(date, 1)) {
		dates.push(date)
	}
	return dates
}

/**
 * Says whether `text` is a date that exists. `new Date` turns `2026-02-30` into
 * Mar 2 with no error, so this compares the date it gets back with `text`.
 *
 * @param {string} text Date from the Sheet.
 * @returns {boolean} `true` for a real date written as `YYYY-MM-DD`.
 */
function isRealDate(text) {
	const date = new Date(`${text}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return false
	return date.toISOString().slice(0, 10) === text
}

/**
 * Lists the check-in dates that can still give a stay inside the window. The
 * first is the later of `start` and `today`. The last is `end` minus
 * `minNights`.
 *
 * Throws for an invalid window, which is reversed or has an impossible date. An
 * invalid window isn't a finished window.
 *
 * @param {string} start Start of the window, `YYYY-MM-DD`.
 * @param {string} end End of the window, `YYYY-MM-DD`. It's a check-out date.
 * @param {string} today `YYYY-MM-DD`.
 * @param {number} minNights Length of the stay each check-in date asks about.
 * @returns {string[]} The check-in dates in order, `YYYY-MM-DD`. Empty when the
 *   window is finished.
 */
function chooseCheckIns(start, end, today, minNights) {
	const isWindowValid = isRealDate(start) && isRealDate(end) && start <= end
	if (!isWindowValid) {
		// No dates in this text, because error messages reach the public log
		throw new Error(
			'The window has an impossible date, or its start is after its end.',
		)
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
 * 3. Find stretches. With none, stop and return `green`.
 * 4. Dedup against the alerted stretches in state.
 * 5. Send one Slack message for the new stretches, if any.
 * 6. Write state.
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
		adults = 2,
		children = 0,
		min_nights = 3,
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

		if (stretches.length === 0) {
			console.log('   No stretches found.')
			return 'green'
		}

		let newStretches = stretches
		let state = { rowIndex: null, lastChecked: null, alertedStretches: [] }

		if (stateStore) {
			state = await stateStore.read(id)
			newStretches = deduplicateStretches(stretches, state.alertedStretches)
		}

		if (newStretches.length === 0) {
			console.log('   All stretches already alerted.')
			// Still write. This updates last_checked and drops alerted stretches
			// that went away.
			if (stateStore && !isDryRun) {
				state.alertedStretches = stretches
				await stateStore.write(id, state)
			}
			return 'green'
		}

		if (isDryRun) {
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

		if (stateStore && !isDryRun) {
			// Save every current stretch. Saving only newStretches would alert the
			// others again.
			state.alertedStretches = stretches
			await stateStore.write(id, state)
			console.log('   State updated.')
		}

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

// CLI entrypoint. Reads the environment, wires the real dependencies and exits.
if (import.meta.main) {
	const isDryRun =
		process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'

	if (isDryRun) {
		console.log('🐶 Bookdog — DRY RUN MODE (no alerts, no state writes)')
	}

	const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''
	const sheetId = process.env.GOOGLE_SHEET_ID || ''

	let watchdog
	try {
		watchdog = JSON.parse(process.env.WATCHDOG_CONFIG || '{}')
	} catch {
		console.error('Failed to parse WATCHDOG_CONFIG')
		process.exit(1)
	}

	const { id, property_url, checkin_date, checkout_date } = watchdog

	if (!id || !property_url || !checkin_date || !checkout_date) {
		console.error('Missing required config fields')
		process.exit(1)
	}

	// getAuth stays inside read and write, so a bad key throws inside
	// `runWatchdog` and reaches the Slack error path
	const stateStore = sheetId
		? {
				read: (watchdogId) => readState(sheetId, watchdogId, getAuth()),
				write: (watchdogId, state) =>
					writeState(sheetId, watchdogId, state, getAuth()),
			}
		: null

	const result = await runWatchdog({
		watchdog,
		today: new Date().toISOString().slice(0, 10),
		scrape: scrapeAvailability,
		stateStore,
		webhookUrl,
		isDryRun,
	})
	process.exit(result === 'green' ? 0 : 1)
}
