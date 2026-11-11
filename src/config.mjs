/**
 * Reads watchdogs from the `config` tab of the Sheet. The first workflow job
 * starts this file as a script to build the matrix for the check jobs.
 */

import { writeFileSync } from 'node:fs'
import { google } from 'googleapis'
import {
	DEFAULT_ADULTS,
	DEFAULT_CHILDREN,
	DEFAULT_MIN_NIGHTS,
} from './constants.mjs'

/**
 * Builds the Google login from the `GOOGLE_SERVICE_ACCOUNT_KEY` JSON. It asks
 * for read and write access, because `check.mjs` uses this login to write state.
 * Throws when the variable is missing or isn't valid JSON.
 *
 * @returns {import('googleapis').Auth.JWT} The login.
 */
function getAuth() {
	const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
	return new google.auth.JWT({
		email: key.client_email,
		key: key.private_key,
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	})
}

/**
 * Turns a date cell into `YYYY-MM-DD`. A blank or unreadable cell gives an empty
 * string, and `loadConfig` then skips the row.
 *
 * @param {string | undefined} val Cell text from the Sheet.
 * @returns {string} The date, or an empty string.
 */
function normalizeDate(val) {
	if (!val) return ''
	// Already YYYY-MM-DD. This checks the shape only, so 2026-13-45 passes.
	if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val
	// new Date reads this as month first, in local time. GitHub runners use UTC,
	// so the date holds there. East of UTC, a date with no time comes out a day
	// early.
	const d = new Date(val)
	if (Number.isNaN(d.getTime())) return ''
	return d.toISOString().slice(0, 10)
}

/**
 * Turns a number cell into a count. A blank, zero, negative or unreadable cell
 * gives `fallback`.
 *
 * `parseInt` reads only the whole number at the start of the cell, so `2.5`
 * gives 2.
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
 * Reads the enabled watchdogs from the `config` tab. Row 1 holds the headers.
 *
 * A row is enabled when its `enabled` cell is blank or TRUE, in any case. Any
 * other value pauses it. This function skips a row with no id, URL or readable
 * dates, and warns with the row number.
 *
 * A blank, zero, negative or unreadable number cell takes its default from
 * `constants.mjs`.
 *
 * @param {string} sheetId The ID from the Sheet's URL.
 * @param {import('googleapis').Auth.JWT} auth Login from `getAuth`.
 * @returns {Promise<import('./watchdog.mjs').Watchdog[]>} Watchdogs in row order.
 */
export async function loadConfig(sheetId, auth) {
	const sheets = google.sheets({ version: 'v4', auth })
	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: sheetId,
		range: 'config!A:J',
	})

	const rows = res.data.values || []
	if (rows.length <= 1) return [] // header only or empty

	const configs = []
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i]
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
		const enabled =
			row[9] === undefined ||
			row[9] === '' ||
			row[9].toString().toUpperCase() === 'TRUE'

		if (!enabled) continue

		if (!id) {
			console.warn(`Row ${i + 1}: missing id, skipping`)
			continue
		}
		if (!propertyUrl || !checkinDate || !checkoutDate) {
			console.warn(`Row ${i + 1}: missing required fields, skipping`)
			continue
		}

		configs.push({
			id,
			name,
			property_url: propertyUrl,
			checkin_date: checkinDate,
			checkout_date: checkoutDate,
			adults,
			children,
			min_nights: minNights,
		})
	}

	return configs
}

// CLI entrypoint. Loads the watchdogs, then writes `matrix.json` on GitHub or
// prints the JSON elsewhere.
if (import.meta.main) {
	const sheetId = process.env.GOOGLE_SHEET_ID
	if (!sheetId) {
		console.error('GOOGLE_SHEET_ID env required')
		process.exit(1)
	}

	const auth = getAuth()
	const configs = await loadConfig(sheetId, auth)
	const json = JSON.stringify(configs)
	console.log(`Loaded ${configs.length} watchdog(s)`)

	// The job that runs this holds secrets, and GitHub masks secret values in its
	// outputs. So the matrix leaves as a file, for a job without secrets.
	if (process.env.GITHUB_OUTPUT) {
		writeFileSync('matrix.json', json)
	} else {
		console.log(json)
	}
}

export { getAuth }
