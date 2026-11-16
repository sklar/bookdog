/**
 * Reads watchdogs from the `config` tab of the Sheet.
 *
 * The `list-rows` job of Check Availability runs this file as a script. It
 * lists the rows of the enabled watchdogs, and each row becomes one check job.
 * That job reads its row with `loadRow`.
 *
 * The public log gets only row numbers and skip reasons from this file, and
 * the job outputs get only row numbers.
 */

import { appendFileSync } from 'node:fs'
import { google } from 'googleapis'
import {
	DEFAULT_ADULTS,
	DEFAULT_CHILDREN,
	DEFAULT_MIN_NIGHTS,
} from './constants.mjs'
import { createLogger, isOutsideCi } from './logger.mjs'

/**
 * Builds the Google login from the JSON in `GOOGLE_SERVICE_ACCOUNT_KEY`.
 *
 * It asks for read and write access, because `check.mjs` also writes state
 * with it. It throws when the variable is missing or isn't valid JSON. That
 * parse error quotes a piece of the key, so callers log it only through
 * `logger.error`, which shows just its name on GitHub.
 *
 * @returns {import('googleapis').Auth.JWT} The login.
 */
export function getAuth() {
	const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
	return new google.auth.JWT({
		email: key.client_email,
		key: key.private_key,
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	})
}

/**
 * Reads cells from the `config` tab, in one Sheets API call.
 *
 * @param {string} sheetId The ID from the Sheet's URL.
 * @param {string} cells Cells in A1 notation, without the tab, such as `A:J`.
 * @param {import('googleapis').Auth.JWT} auth Login from `getAuth`.
 * @returns {Promise<string[][]>} The cells of each row. Sheets leaves out
 *   blank rows at the end, and blank cells at the end of a row.
 */
async function readConfigCells(sheetId, cells, auth) {
	const sheets = google.sheets({ version: 'v4', auth })
	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: sheetId,
		range: `config!${cells}`,
	})
	return res.data.values || []
}

/**
 * Turns a date cell into `YYYY-MM-DD`.
 *
 * A blank or unreadable cell gives an empty string, and `parseRow` then skips
 * the row.
 *
 * @param {string | undefined} val Cell text from the Sheet.
 * @returns {string} The date, or an empty string.
 */
function normalizeDate(val) {
	if (!val) return ''
	// Already YYYY-MM-DD. This checks the shape only, so 2026-13-45 passes here,
	// and the watchdog reports it as an invalid window.
	if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val
	// new Date reads `1/2/2026` as January 2, in local time. GitHub runners use
	// UTC, so the date holds there. East of UTC, a date with no time comes out a
	// day early.
	const d = new Date(val)
	if (Number.isNaN(d.getTime())) return ''
	return d.toISOString().slice(0, 10)
}

/**
 * Turns a number cell into a count.
 *
 * A blank, zero, negative or unreadable cell gives `fallback`. `parseInt`
 * reads only the whole number at the start of the cell, so `2.5` gives 2.
 *
 * @param {string | undefined} val Cell text from the Sheet.
 * @param {number} fallback Default from `constants.mjs`.
 * @returns {number} A whole number of at least 1, or `fallback`.
 */
function normalizeCount(val, fallback) {
	const count = parseInt(val, 10)
	const isUsable = count > 0
	return isUsable ? count : fallback
}

/**
 * Why a row of the `config` tab holds no watchdog.
 *
 * Each reason is fixed text with no Sheet data, so the public log can show it.
 * `not enabled` means the owner paused the row.
 *
 * @typedef {'not enabled' | 'missing id' | 'missing required fields'} SkipReason
 */

/**
 * The watchdog in one row of the `config` tab, or the reason the row holds
 * none.
 *
 * @typedef {{ watchdog: import('./watchdog.mjs').Watchdog }
 *   | { watchdog: null, skipReason: SkipReason }} ParsedRow
 */

/**
 * Turns the cells of one `config` row into a watchdog.
 *
 * A row is enabled when its `enabled` cell is blank or TRUE, in any case. Any
 * other value pauses it. A row with no id, URL or readable dates holds no
 * watchdog either.
 *
 * A blank, zero, negative or unreadable number cell takes its default from
 * `constants.mjs`.
 *
 * @param {string[]} row Cells from column A on. Sheets leaves out blank cells
 *   at the end.
 * @returns {ParsedRow} The watchdog, or the reason the row holds none.
 */
function parseRow(row) {
	// Columns: A=Timestamp, B=name, C=property_url, D=checkin, E=checkout,
	// F=adults, G=children, H=min_nights, I=id, J=enabled. The Form fills A to H,
	// an Apps Script fills I, and the owner sets J by hand.
	const name = (row[1] || '').trim()
	const propertyUrl = (row[2] || '').trim()
	const checkinDate = normalizeDate(row[3])
	const checkoutDate = normalizeDate(row[4])
	const adults = normalizeCount(row[5], DEFAULT_ADULTS)
	const children = normalizeCount(row[6], DEFAULT_CHILDREN)
	const minNights = normalizeCount(row[7], DEFAULT_MIN_NIGHTS)
	const id = (row[8] || '').trim()
	const isEnabled =
		row[9] === undefined ||
		row[9] === '' ||
		row[9].toString().toUpperCase() === 'TRUE'
	const hasRequiredCells = Boolean(propertyUrl && checkinDate && checkoutDate)

	if (!isEnabled) return { watchdog: null, skipReason: 'not enabled' }
	if (!id) return { watchdog: null, skipReason: 'missing id' }
	if (!hasRequiredCells) {
		return { watchdog: null, skipReason: 'missing required fields' }
	}

	return {
		watchdog: {
			id,
			name,
			property_url: propertyUrl,
			checkin_date: checkinDate,
			checkout_date: checkoutDate,
			adults,
			children,
			min_nights: minNights,
		},
	}
}

/**
 * Lists the rows of the `config` tab that hold an enabled watchdog.
 *
 * Row 1 holds the headers. A row that is enabled but holds no watchdog gets a
 * log line, such as `Row 4: missing id, skipping`. A paused row gets none.
 *
 * @param {string} sheetId The ID from the Sheet's URL.
 * @param {import('googleapis').Auth.JWT} auth Login from `getAuth`.
 * @param {import('./logger.mjs').Logger} logger Prints the skip lines.
 * @returns {Promise<number[]>} Row numbers as the Sheet shows them, counted
 *   from 1, in order.
 */
export async function loadEnabledRows(sheetId, auth, logger) {
	const rows = await readConfigCells(sheetId, 'A:J', auth)
	const rowNumbers = []
	for (let i = 1; i < rows.length; i++) {
		const rowNumber = i + 1
		const parsed = parseRow(rows[i])
		if (parsed.watchdog) {
			rowNumbers.push(rowNumber)
			continue
		}
		if (parsed.skipReason !== 'not enabled') {
			logger.log(`Row ${rowNumber}: ${parsed.skipReason}, skipping`)
		}
	}

	return rowNumbers
}

/**
 * Reads the watchdog in one row of the `config` tab.
 *
 * The owner can edit the Sheet between `list-rows` and the check job, so the
 * row may no longer hold an enabled watchdog.
 *
 * @param {string} sheetId The ID from the Sheet's URL.
 * @param {number} rowNumber Row as the Sheet shows it, counted from 1. Row 1
 *   holds the headers.
 * @param {import('googleapis').Auth.JWT} auth Login from `getAuth`.
 * @returns {Promise<ParsedRow>} The watchdog, or the reason the row holds
 *   none.
 */
export async function loadRow(sheetId, rowNumber, auth) {
	const cells = `A${rowNumber}:J${rowNumber}`
	// A row past the last one comes back with no values
	const [row = []] = await readConfigCells(sheetId, cells, auth)
	return parseRow(row)
}

// CLI entrypoint, for the `list-rows` job. It writes the rows as the `rows` job
// output. GitHub drops an output that holds a secret, and a list of row
// numbers holds none.
if (import.meta.main) {
	const logger = createLogger(isOutsideCi())
	const sheetId = process.env.GOOGLE_SHEET_ID
	if (!sheetId) {
		logger.error('Listing the rows needs GOOGLE_SHEET_ID')
		process.exit(1)
	}
	if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
		logger.error('Listing the rows needs GOOGLE_SERVICE_ACCOUNT_KEY')
		process.exit(1)
	}

	let rowNumbers
	try {
		rowNumbers = await loadEnabledRows(sheetId, getAuth(), logger)
	} catch (err) {
		// The message may quote the key, see `getAuth`
		logger.error('Failed to read the config tab', err)
		process.exit(1)
	}

	const json = JSON.stringify(rowNumbers)
	logger.log(`Enabled rows: ${json}`)
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `rows=${json}\n`)
	}
}
