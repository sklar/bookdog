/**
 * Read/write watchdog state from Google Sheets state tab.
 */
import { google } from 'googleapis'

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
				alertedRuns: JSON.parse(rows[i][2] || '[]'),
			}
		}
	}

	return { rowIndex: null, lastChecked: null, alertedRuns: [] }
}

export async function writeState(sheetId, watchdogId, state, auth) {
	const sheets = google.sheets({ version: 'v4', auth })
	const now = new Date().toISOString()
	const values = [[watchdogId, now, JSON.stringify(state.alertedRuns)]]

	if (state.rowIndex) {
		// Update existing row
		await sheets.spreadsheets.values.update({
			spreadsheetId: sheetId,
			range: `state!A${state.rowIndex}:C${state.rowIndex}`,
			valueInputOption: 'RAW',
			requestBody: { values },
		})
	} else {
		// Append new row
		await sheets.spreadsheets.values.append({
			spreadsheetId: sheetId,
			range: 'state!A:C',
			valueInputOption: 'RAW',
			requestBody: { values },
		})
	}
}
