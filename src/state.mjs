/**
 * Reads and writes the `state` tab of the Sheet. A watchdog's row holds the
 * stretches that already had an alert, so the next check can skip them. Row 1
 * holds the headers.
 *
 * Columns: A=watchdog_id, B=last_checked, C=alerted_runs as JSON. Columns are
 * read by position, so the old header name in C can stay.
 */
import { google } from 'googleapis'

/**
 * One watchdog's row in the `state` tab.
 *
 * @typedef {object} State
 * @property {number | null} rowIndex Sheet row, counted from 1. `null` when the
 *   watchdog has no row yet.
 * @property {string | null} lastChecked Time of the last write, ISO format.
 * @property {import('./check.mjs').Stretch[]} alertedStretches Stretches that
 *   already had an alert.
 */

/**
 * Finds the watchdog's row. A watchdog with no row gets an empty state. Throws
 * when the `alerted_runs` cell isn't valid JSON.
 *
 * @param {string} sheetId The ID from the Sheet's URL.
 * @param {string} watchdogId
 * @param {import('googleapis').Auth.JWT} auth Login from `getAuth`.
 * @returns {Promise<State>} The state.
 */
export async function readState(sheetId, watchdogId, auth) {
	const sheets = google.sheets({ version: 'v4', auth })
	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: sheetId,
		range: 'state!A:C',
	})

	const rows = res.data.values || []
	for (let i = 1; i < rows.length; i++) {
		if (rows[i][0] === watchdogId) {
			return {
				rowIndex: i + 1, // 1-based sheet row
				lastChecked: rows[i][1] || null,
				alertedStretches: JSON.parse(rows[i][2] || '[]'),
			}
		}
	}

	return { rowIndex: null, lastChecked: null, alertedStretches: [] }
}

/**
 * Saves the alerted stretches with the current time. It updates the row that
 * `rowIndex` names, and adds a row when `rowIndex` is `null`. A state with no
 * `rowIndex` for a watchdog that has a row gives that watchdog a second row.
 *
 * @param {string} sheetId The ID from the Sheet's URL.
 * @param {string} watchdogId
 * @param {State} state The object `readState` returned, with new
 *   `alertedStretches`.
 * @param {import('googleapis').Auth.JWT} auth Login from `getAuth`.
 * @returns {Promise<void>} Resolves after the write.
 */
export async function writeState(sheetId, watchdogId, state, auth) {
	const sheets = google.sheets({ version: 'v4', auth })
	const now = new Date().toISOString()
	const values = [[watchdogId, now, JSON.stringify(state.alertedStretches)]]

	// RAW stores the text as it is, so Sheets can't turn the time into a date
	if (state.rowIndex) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: sheetId,
			range: `state!A${state.rowIndex}:C${state.rowIndex}`,
			valueInputOption: 'RAW',
			requestBody: { values },
		})
	} else {
		await sheets.spreadsheets.values.append({
			spreadsheetId: sheetId,
			range: 'state!A:C',
			valueInputOption: 'RAW',
			requestBody: { values },
		})
	}
}
