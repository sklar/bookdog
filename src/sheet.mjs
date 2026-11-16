/**
 * Opens the Google Sheet with the `config` and `state` tabs, and reads and
 * writes its cells. `config.mjs` and `state.mjs` both go through it, so this is
 * the only file that loads `googleapis`.
 */

import { google } from 'googleapis'

/**
 * The Google Sheet with the `config` and `state` tabs, and the login to it.
 *
 * @typedef {object} Sheet
 * @property {string} id The ID from the Sheet's URL.
 * @property {import('googleapis').Auth.JWT} auth Login from the JSON in
 *   `GOOGLE_SERVICE_ACCOUNT_KEY`.
 */

/**
 * Pairs the Sheet's ID with a login from the JSON in
 * `GOOGLE_SERVICE_ACCOUNT_KEY`.
 *
 * The login asks for read and write access, because `check.mjs` also writes
 * state with it. It throws when the variable is missing or isn't valid JSON.
 * That parse error quotes a piece of the key, so callers log it only through
 * `logger.error`, which shows just its name on GitHub.
 *
 * @param {string} id The ID from the Sheet's URL.
 * @returns {Sheet} The Sheet.
 */
export function openSheet(id) {
	const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
	const auth = new google.auth.JWT({
		email: key.client_email,
		key: key.private_key,
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	})
	return { id, auth }
}

/**
 * Gives the Sheets API calls for cell values, logged in to the Sheet.
 *
 * @param {Sheet} sheet
 * @returns {import('googleapis').sheets_v4.Resource$Spreadsheets$Values} The
 *   calls.
 */
function cellValues({ auth }) {
	return google.sheets({ version: 'v4', auth }).spreadsheets.values
}

/**
 * Reads cells in one Sheets API call.
 *
 * @param {Sheet} sheet
 * @param {string} range Tab and cells in A1 notation, such as `config!A:J`.
 * @returns {Promise<string[][]>} The cells of each row. Sheets leaves out
 *   blank rows at the end, and blank cells at the end of a row.
 */
export async function readCells(sheet, range) {
	const res = await cellValues(sheet).get({ spreadsheetId: sheet.id, range })
	return res.data.values || []
}

/**
 * Writes cells over the ones in `range`.
 *
 * RAW stores the text as it is, so Sheets can't turn a time into a date.
 *
 * @param {Sheet} sheet
 * @param {string} range Tab and cells in A1 notation, such as `state!A7:C7`.
 * @param {string[][]} values The cells of each row.
 * @returns {Promise<void>} Resolves after the write.
 */
export async function writeCells(sheet, range, values) {
	await cellValues(sheet).update({
		spreadsheetId: sheet.id,
		range,
		valueInputOption: 'RAW',
		requestBody: { values },
	})
}

/**
 * Adds rows after the last row of the table in `range`.
 *
 * RAW stores the text as it is, so Sheets can't turn a time into a date.
 *
 * @param {Sheet} sheet
 * @param {string} range Tab and columns in A1 notation, such as `state!A:C`.
 * @param {string[][]} values The cells of each row.
 * @returns {Promise<void>} Resolves after the write.
 */
export async function appendCells(sheet, range, values) {
	await cellValues(sheet).append({
		spreadsheetId: sheet.id,
		range,
		valueInputOption: 'RAW',
		requestBody: { values },
	})
}
