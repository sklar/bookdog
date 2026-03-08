/**
 * Read watchdog config from Google Sheets.
 */

import { writeFileSync } from 'node:fs'
import { google } from 'googleapis'

function getAuth() {
	const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
	return new google.auth.GoogleAuth({
		credentials: key,
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	})
}

function normalizeDate(val) {
	if (!val) return ''
	// Already YYYY-MM-DD
	if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val
	// Try parsing as Date
	const d = new Date(val)
	if (Number.isNaN(d.getTime())) return ''
	return d.toISOString().slice(0, 10)
}

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
		// Columns: A=Timestamp, B=name, C=property_url, D=checkin, E=checkout, F=adults, G=children, H=min_nights, I=id, J=enabled
		const name = (row[1] || '').trim()
		const propertyUrl = (row[2] || '').trim()
		const checkinDate = normalizeDate(row[3])
		const checkoutDate = normalizeDate(row[4])
		const adults = parseInt(row[5], 10) || 2
		const children = parseInt(row[6], 10) || 0
		const minNights = parseInt(row[7], 10) || 3
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

// CLI entrypoint
const isMain =
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
if (isMain) {
	const sheetId = process.env.GOOGLE_SHEET_ID
	if (!sheetId) {
		console.error('GOOGLE_SHEET_ID env required')
		process.exit(1)
	}

	const auth = getAuth()
	const configs = await loadConfig(sheetId, auth)
	const json = JSON.stringify(configs)
	console.log(`Loaded ${configs.length} watchdog(s)`)

	// Write matrix to file for CI (avoids secret-masking on job outputs)
	if (process.env.GITHUB_OUTPUT) {
		writeFileSync('matrix.json', json)
	} else {
		console.log(json)
	}
}

export { getAuth }
