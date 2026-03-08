/**
 * Main entrypoint — orchestrates one watchdog run.
 */

import { getAuth } from './config.mjs'
import { scrapeAvailability } from './scraper.mjs'
import { sendAlert, sendError } from './slack.mjs'
import { readState, writeState } from './state.mjs'

export function findConsecutiveRuns(availability, minNights) {
	const sorted = [...availability].sort((a, b) => a.date.localeCompare(b.date))
	const runs = []
	let runStart = null
	let runLength = 0

	for (let i = 0; i < sorted.length; i++) {
		if (sorted[i].available) {
			if (!runStart) runStart = sorted[i].date
			runLength++
		} else {
			if (runLength >= minNights) {
				runs.push({
					start: runStart,
					end: sorted[i - 1].date,
					nights: runLength,
				})
			}
			runStart = null
			runLength = 0
		}
	}

	// Handle trailing run
	if (runLength >= minNights) {
		runs.push({
			start: runStart,
			end: sorted.at(-1).date,
			nights: runLength,
		})
	}

	return runs
}

export function deduplicateRuns(currentRuns, alertedRuns) {
	return currentRuns.filter(
		(run) =>
			!alertedRuns.some((a) => a.start === run.start && a.end === run.end),
	)
}

const isDryRun =
	process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true'

// CLI entrypoint
const isMain =
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
if (isMain) {
	if (isDryRun) {
		console.log('🐶 Bookdog — DRY RUN MODE (no alerts, no state writes)')
	}

	const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''
	const sheetId = process.env.GOOGLE_SHEET_ID || ''

	let config
	try {
		config = JSON.parse(process.env.WATCHDOG_CONFIG || '{}')
	} catch {
		console.error('Failed to parse WATCHDOG_CONFIG')
		process.exit(1)
	}

	const {
		id,
		name,
		property_url,
		checkin_date,
		checkout_date,
		adults = 2,
		children = 0,
		min_nights = 3,
	} = config

	if (!id || !property_url || !checkin_date || !checkout_date) {
		console.error('Missing required config fields')
		process.exit(1)
	}

	console.log(`🐶 Bookdog — ${id}`)
	console.log(`   Property: ${property_url}`)
	console.log(`   Dates: ${checkin_date} → ${checkout_date}`)
	console.log(
		`   Min nights: ${min_nights} | Adults: ${adults} | Children: ${children}`,
	)

	try {
		// Scrape
		const availability = await scrapeAvailability(
			property_url,
			checkin_date,
			checkout_date,
			adults,
			children,
			min_nights,
		)
		const availCount = availability.filter((d) => d.available).length
		console.log(`   Available dates: ${availCount}/${availability.length}`)

		// Find runs
		const runs = findConsecutiveRuns(availability, min_nights)
		console.log(`   Qualifying runs (≥${min_nights} nights): ${runs.length}`)

		if (runs.length === 0) {
			console.log('   No qualifying runs found.')
			process.exit(0)
		}

		// Dedup against state
		let newRuns = runs
		let state = { rowIndex: null, lastChecked: null, alertedRuns: [] }

		if (sheetId) {
			const auth = getAuth()
			state = await readState(sheetId, id, auth)
			newRuns = deduplicateRuns(runs, state.alertedRuns)
		}

		if (newRuns.length === 0) {
			console.log('   All runs already alerted.')
			// Still update last_checked
			if (sheetId && !isDryRun) {
				const auth = getAuth()
				state.alertedRuns = runs
				await writeState(sheetId, id, state, auth)
			}
			process.exit(0)
		}

		// Alert
		if (isDryRun) {
			console.log('[DRY RUN] Would send alert:')
			for (const r of newRuns) {
				console.log(`  ✅ ${r.start} → ${r.end} (${r.nights} nights)`)
			}
		} else {
			await sendAlert(
				webhookUrl,
				id,
				name,
				property_url,
				newRuns,
				adults,
				children,
			)
			console.log('   Slack alert sent!')
		}

		// Write state
		if (sheetId && !isDryRun) {
			const auth = getAuth()
			state.alertedRuns = runs // overwrite with full current snapshot
			await writeState(sheetId, id, state, auth)
			console.log('   State updated.')
		}
	} catch (err) {
		console.error(`Error: ${err.message}`)
		if (!isDryRun) {
			await sendError(webhookUrl, id, name, err.message).catch(() => {})
		}
		process.exit(1)
	}
}
