/**
 * The CLI for one watchdog. Reads the environment, wires the real scrape and
 * Sheet into `runWatchdog`, then exits.
 */

import { getAuth } from './config.mjs'
import { scrapeAvailability } from './scraper.mjs'
import { readState, writeState } from './state.mjs'
import { runWatchdog } from './watchdog.mjs'

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
	today: Temporal.Now.plainDateISO('UTC').toString(),
	scrape: scrapeAvailability,
	stateStore,
	webhookUrl,
	isDryRun,
})
process.exit(result === 'green' ? 0 : 1)
