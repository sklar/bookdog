/**
 * Reads and writes the `state` tab of the Sheet. A watchdog's row holds the
 * stretches that already had an alert, so the next check can skip them. Row 1
 * holds the headers.
 *
 * Columns: A=watchdog_id, B=last_checked, C=alerted_runs as JSON. Columns are
 * read by position, so the old header name in C can stay.
 */
import { appendCells, readCells, writeCells } from './sheet.mjs'

/**
 * One watchdog's row in the `state` tab.
 *
 * @typedef {object} State
 * @property {number | null} rowIndex Sheet row, counted from 1. `null` when the
 *   watchdog has no row yet.
 * @property {string | null} lastChecked Time of the last write, ISO format.
 * @property {import('./stretches.mjs').Stretch[]} alertedStretches
 *   Stretches that already had an alert.
 */

/**
 * Finds the watchdog's row. A watchdog with no row gets an empty state. Throws
 * when the `alerted_runs` cell isn't valid JSON.
 *
 * @param {import('./sheet.mjs').Sheet} sheet
 * @param {string} watchdogId
 * @returns {Promise<State>} The state.
 */
export async function readState(sheet, watchdogId) {
	const rows = await readCells(sheet, 'state!A:C')
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
 * @param {import('./sheet.mjs').Sheet} sheet
 * @param {string} watchdogId
 * @param {State} state A copy of what `readState` returned, with new
 *   `alertedStretches`.
 * @returns {Promise<void>} Resolves after the write.
 */
export async function writeState(sheet, watchdogId, state) {
	const now = new Date().toISOString()
	const values = [[watchdogId, now, JSON.stringify(state.alertedStretches)]]

	if (!state.rowIndex) {
		await appendCells(sheet, 'state!A:C', values)
		return
	}
	const range = `state!A${state.rowIndex}:C${state.rowIndex}`
	await writeCells(sheet, range, values)
}
