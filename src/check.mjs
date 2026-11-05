/**
 * Checks one watchdog. `runWatchdog` holds the logic, and the CLI block at the
 * bottom wires in the real scrape, Sheet and Slack.
 */

import { getAuth } from './config.mjs'
import { addDays } from './dates.mjs'
import { scrapeAvailability } from './scraper.mjs'
import { sendAlert, sendError } from './slack.mjs'
import { readState, writeState } from './state.mjs'

/**
 * One row of the Sheet, as the CLI reads it from `WATCHDOG_CONFIG`.
 *
 * @typedef {object} Watchdog
 * @property {string} id
 * @property {string} [name] Title of the Slack messages.
 * @property {string} property_url
 * @property {string} checkin_date Start of the window, `YYYY-MM-DD`.
 * @property {string} checkout_date End of the window, `YYYY-MM-DD`.
 * @property {number} [adults] Defaults to 2.
 * @property {number} [children] Defaults to 0.
 * @property {number} [min_nights] Defaults to 3.
 */

/**
 * Free nights in a sequence.
 *
 * @typedef {object} Stretch
 * @property {string} start First available date.
 * @property {string} end Last available date, not the check-out date.
 * @property {number} nights Count of available dates.
 */

/**
 * Finds each stretch of at least `minNights` available dates. Any date that
 * isn't available ends the sequence.
 *
 * @param {{ date: string, available: boolean }[]} availability Dates in any order.
 * @param {number} minNights Shortest stretch to report.
 * @returns {Stretch[]} Stretches in date order.
 */
export function findConsecutiveRuns(availability, minNights) {
	const sorted = [...availability].sort((a, b) => a.date.localeCompare(b.date))
	const runs = []
	let runStart = null
	let runLength = 0

	for (let i = 0; i < sorted.length; i++) {
		if (sorted[i].available) {
			if (!runStart) runStart = sorted[i].date
			runLength++
		} else {
			if (runLength >= minNights) {
				runs.push({
					start: runStart,
					end: sorted[i - 1].date,
					nights: runLength,
				})
			}
			runStart = null
			runLength = 0
		}
	}

	// A stretch can reach the last date, so no later date closes it
	if (runLength >= minNights) {
		runs.push({
			start: runStart,
			end: sorted.at(-1).date,
			nights: runLength,
		})
	}

	return runs
}

/**
 * Keeps the stretches that have no alert yet. An alerted stretch matches when
 * `start` and `end` are both equal.
 *
 * @param {Stretch[]} currentRuns Stretches found by this check.
 * @param {Stretch[]} alertedRuns Stretches from state.
 * @returns {Stretch[]} The new stretches.
 */
export function deduplicateRuns(currentRuns, alertedRuns) {
	return currentRuns.filter(
		(run) =>
			!alertedRuns.some((a) => a.start === run.start && a.end === run.end),
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
 * @param {string} text
 * @returns {boolean} `true` for a real date written as `YYYY-MM-DD`.
 */
function isRealDate(text) {
	const date = new Date(`${text}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return false
	return date.toISOString().slice(0, 10) === text
}

/**
 * Lists the check-in dates that can still give a stay inside the window. The
 * first is the later of `start` and `today`. The last is `end` minus `minNights`.
 *
 * Throws for an invalid window, which is reversed or has an impossible date. It
 * isn't a finished window.
 *
 * @param {string} start Start of the window, `YYYY-MM-DD`.
 * @param {string} end End of the window, `YYYY-MM-DD`. It's a check-out date.
 * @param {string} today `YYYY-MM-DD`.
 * @param {number} minNights
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
 * Checks one watchdog in this order: choose dates, scrape, find stretches, dedup,
 * send one Slack message, write state. With no dates left, it stops after the
 * first step and returns `green`. With no stretch, it stops after the third.
 *
 * An error in any step sends the Slack error message and returns `red`. A dry
 * run still scrapes and reads state, but it sends nothing and writes nothing.
 *
 * @param {object} options
 * @param {Watchdog} options.watchdog
 * @param {string} options.today `YYYY-MM-DD`. The CLI passes today in UTC.
 * @param {Function} options.scrape Takes the property URL, check-in dates,
 *   adults, children and minimum nights, in that order. Returns
 *   `{ date, available }` for each date.
 * @param {{ read: Function, write: Function } | null} options.stateStore
 *   `read(id)` returns the state. `write(id, state)` takes the object `read`
 *   returned, because that object holds the Sheet row. `null` keeps no state,
 *   so each check treats every stretch as new.
 * @param {string} options.webhookUrl Slack webhook. An empty string prints the
 *   messages instead.
 * @param {boolean} options.isDryRun
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

		const runs = findConsecutiveRuns(availability, min_nights)
		console.log(`   Qualifying runs (≥${min_nights} nights): ${runs.length}`)

		if (runs.length === 0) {
			console.log('   No qualifying runs found.')
			return 'green'
		}

		let newRuns = runs
		let state = { rowIndex: null, lastChecked: null, alertedRuns: [] }

		if (stateStore) {
			state = await stateStore.read(id)
			newRuns = deduplicateRuns(runs, state.alertedRuns)
		}

		if (newRuns.length === 0) {
			console.log('   All runs already alerted.')
			// Still write. This updates last_checked and drops alerted stretches
			// that went away.
			if (stateStore && !isDryRun) {
				state.alertedRuns = runs
				await stateStore.write(id, state)
			}
			return 'green'
		}

		if (isDryRun) {
			console.log('[DRY RUN] Would send alert:')
			for (const r of newRuns) {
				console.log(`  ✅ ${r.start} → ${r.end} (${r.nights} nights)`)
			}
		} else {
			await sendAlert(
				webhookUrl,
				id,
				name,
				property_url,
				newRuns,
				adults,
				children,
			)
			console.log('   Slack alert sent!')
		}

		if (stateStore && !isDryRun) {
			// Save every current stretch. Saving only newRuns would alert the
			// others again.
			state.alertedRuns = runs
			await stateStore.write(id, state)
			console.log('   State updated.')
		}

		return 'green'
	} catch (err) {
		console.error(`Error: ${err.message}`)
		if (!isDryRun) {
			// Slack may be what failed, so a second failure here changes nothing
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

	// getAuth stays inside read and write, so a bad key reaches the Slack error path
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
