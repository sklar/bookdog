/**
 * The CLI for one watchdog. Each check job of Check Availability starts it
 * with a Sheet row in `WATCHDOG_ROW`. The Integration Test starts it with the
 * whole watchdog in `WATCHDOG_CONFIG`, and `pnpm check.dry` starts it on the
 * owner's machine with either one from `.env`.
 *
 * It reads the watchdog and the secrets from the environment, passes the real
 * scrape and Sheet to `runWatchdog`, and turns the colour it returns into the
 * exit code.
 *
 * On GitHub the log is public, so it shows only the row number and counts.
 * Outside CI the logger is verbose and also shows dates, URLs and error
 * messages.
 */

import { getAuth, loadRow } from './config.mjs'
import { createLogger, isOutsideCi } from './logger.mjs'
import { scrapeAvailability } from './scraper.mjs'
import { readState, writeState } from './state.mjs'
import { runWatchdog } from './watchdog.mjs'

/**
 * Prints the lines of the CLI and of `runWatchdog`, verbose only outside CI.
 */
const logger = createLogger(isOutsideCi())

/**
 * `true` with `--dry-run` or `DRY_RUN=true`. Check Availability sets `DRY_RUN`
 * from its `dry_run` input. A dry run sends no Slack message, not even the
 * error message, and writes no state.
 */
const isDryRun =
	process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'

if (isDryRun) {
	logger.log('🐶 Bookdog — DRY RUN MODE (no alerts, no state writes)')
}

/**
 * Slack webhook. Without one, Slack gets no message, and a verbose log prints
 * each message instead.
 */
const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''

/**
 * The Google Sheet with the `config` and `state` tabs. `WATCHDOG_ROW` needs
 * it. Without one, the check keeps no state, and every stretch counts as new.
 */
const sheetId = process.env.GOOGLE_SHEET_ID || ''

/**
 * The parts of this workflow run's URL. GitHub Actions sets all three, and a
 * check on the owner's machine has none.
 */
const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env
const isWorkflowRun = Boolean(
	GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID,
)

/**
 * Link to this workflow run, for the message about too many unknown dates.
 * `null` on the owner's machine, so that message has no link line.
 */
const workflowRunUrl = isWorkflowRun
	? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
	: null

/**
 * Logs why the check can't start, then exits with 1.
 *
 * Only the two watchdog readers call it, before `runWatchdog` starts, so Slack
 * gets no message. The log and the red workflow run are the only signs.
 *
 * @param {string} line What went wrong. It always prints, so it holds no
 *   Sheet data.
 * @param {unknown} [err] The error. A verbose log shows its message and
 *   cause, and GitHub shows only its name.
 * @returns {never}
 */
function exitBeforeCheck(line, err) {
	logger.error(line, err)
	process.exit(1)
}

/**
 * Reads the watchdog in one row of the `config` tab.
 *
 * Exits with 1 when `WATCHDOG_ROW` isn't a row number, a Google variable is
 * missing, reading the row fails, or the row holds no enabled watchdog. The
 * public log shows only the row number, the reason and the error's name.
 *
 * @param {string} rowText The text of `WATCHDOG_ROW`, such as `5`. Row 1
 *   holds the headers, so it must be 2 or more.
 * @returns {Promise<import('./watchdog.mjs').Watchdog>} The watchdog in the
 *   row.
 */
async function readSheetRow(rowText) {
	const row = Number(rowText)
	const isRowNumber = Number.isInteger(row) && row >= 2
	if (!isRowNumber) {
		exitBeforeCheck('WATCHDOG_ROW must be a row number of 2 or more')
	}

	logger.log(`🐶 Bookdog — Sheet row ${row}`)
	if (!sheetId) exitBeforeCheck('WATCHDOG_ROW needs GOOGLE_SHEET_ID')
	if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
		exitBeforeCheck('WATCHDOG_ROW needs GOOGLE_SERVICE_ACCOUNT_KEY')
	}

	let parsed
	try {
		parsed = await loadRow(sheetId, row, getAuth())
	} catch (err) {
		exitBeforeCheck(`Failed to read Sheet row ${row}`, err)
	}
	if (!parsed.watchdog) {
		exitBeforeCheck(
			`Sheet row ${row} is no longer an enabled watchdog: ${parsed.skipReason}`,
		)
	}
	return parsed.watchdog
}

/**
 * Reads the watchdog from the JSON in `WATCHDOG_CONFIG`, which the Integration
 * Test and `.env` set.
 *
 * Exits with 1 when the JSON is invalid or lacks a required field. The log
 * names each missing field. Field names aren't Sheet data, so the public log
 * can show them.
 *
 * @returns {import('./watchdog.mjs').Watchdog} The watchdog.
 */
function readConfigVariable() {
	logger.log('🐶 Bookdog — watchdog from WATCHDOG_CONFIG')

	let watchdog
	try {
		watchdog = JSON.parse(process.env.WATCHDOG_CONFIG || '{}')
	} catch (err) {
		// The parse error quotes a piece of the JSON, which may be the watchdog's
		// URL. So only a verbose log shows it, and GitHub shows `SyntaxError`.
		exitBeforeCheck('Failed to parse WATCHDOG_CONFIG', err)
	}

	const requiredFields = ['id', 'property_url', 'checkin_date', 'checkout_date']
	const missingFields = requiredFields.filter((field) => !watchdog?.[field])
	if (missingFields.length > 0) {
		exitBeforeCheck(`WATCHDOG_CONFIG lacks ${missingFields.join(', ')}`)
	}
	return watchdog
}

/**
 * The row of the `config` tab to check, or `''` to read `WATCHDOG_CONFIG`.
 *
 * Check Availability gives each job only its row, so the public job name and
 * log hold no Sheet data. When both variables are set, `WATCHDOG_ROW` wins.
 * The owner can take the number of a red "Check row 5" job and rerun it on
 * their machine without editing `.env`. The verbose log there shows the
 * dates and error messages.
 */
const watchdogRow = process.env.WATCHDOG_ROW || ''
const watchdog = watchdogRow
	? await readSheetRow(watchdogRow)
	: readConfigVariable()

/**
 * Reads and writes the watchdog's row in the `state` tab. `null` without
 * `GOOGLE_SHEET_ID`.
 *
 * `getAuth` runs on each read and write, not when the CLI starts. With
 * `WATCHDOG_CONFIG`, a bad key then throws inside `runWatchdog`, which sends
 * the error message. With `WATCHDOG_ROW`, `readSheetRow` has already exited on
 * it.
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
	logger,
})

// Red exits 1 and fails the workflow run. `cleanup.yml` deletes only
// successful workflow runs, so a red one keeps its log for debugging.
process.exit(result === 'green' ? 0 : 1)
