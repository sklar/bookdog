/**
 * The CLI for one watchdog. The workflow starts it once per watchdog, and
 * `pnpm check.dry` starts it on the owner's machine with `.env`.
 *
 * It reads the watchdog and the secrets from the environment, passes the real
 * scrape and Sheet to `runWatchdog`, and turns the colour it returns into the
 * exit code.
 */

import { getAuth } from './config.mjs'
import { scrapeAvailability } from './scraper.mjs'
import { readState, writeState } from './state.mjs'
import { runWatchdog } from './watchdog.mjs'

/**
 * Set by `--dry-run` or `DRY_RUN=true`. The workflow sets `DRY_RUN` from its
 * `dry_run` input. A dry run sends no Slack message, not even the error
 * message, and writes no state.
 */
const isDryRun =
	process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'

if (isDryRun) {
	console.log('🐶 Bookdog — DRY RUN MODE (no alerts, no state writes)')
}

/**
 * Slack webhook. Without one, the messages print to the log instead.
 */
const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''

/**
 * The Google Sheet with the `state` tab. Without one, the check keeps no
 * state, and every stretch counts as new.
 */
const sheetId = process.env.GOOGLE_SHEET_ID || ''

// GitHub Actions sets all three. A check on the owner's machine has none.
const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env
const isWorkflowRun = Boolean(
	GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID,
)

/**
 * Link to this workflow run, for the unknown message. `null` on the owner's
 * machine, so that message has no link line.
 */
const workflowRunUrl = isWorkflowRun
	? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
	: null

// Both config errors below exit before `runWatchdog`, so they send no Slack
// message. Only the log and the red workflow run show them.
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

/**
 * Reads and writes the watchdog's row in the `state` tab.
 *
 * `getAuth` runs on each read and write, not when the CLI starts. A bad key
 * then throws inside `runWatchdog`, which sends the error message.
 */
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
	workflowRunUrl,
	isDryRun,
})

// Red exits 1 and fails the workflow run. `cleanup.yml` deletes only
// successful workflow runs, so a red one keeps its log for debugging.
process.exit(result === 'green' ? 0 : 1)
