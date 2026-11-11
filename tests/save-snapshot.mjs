/**
 * Saves a Booking.com page into `tests/fixtures/hotel/`, for a person to trim
 * into a fixture. It overwrites a file of the same name, so give a new page a
 * new name. Without a name, it writes `snapshot.html`.
 *
 * Usage: node tests/save-snapshot.mjs <url> [output-name]
 *
 * The scraper asks for the English page with guests, so the URL should too:
 * node tests/save-snapshot.mjs "https://www.booking.com/hotel/it/grand-hotel-roma.html?checkin=2026-07-01&checkout=2026-07-04&group_adults=2&group_children=0&no_rooms=1&lang=en-gb" grand-hotel-roma
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))

const url = process.argv[2]
const name = process.argv[3] || 'snapshot'

if (!url) {
	console.error('Usage: node tests/save-snapshot.mjs <url> [output-name]')
	process.exit(1)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
	userAgent:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	viewport: { width: 1280, height: 900 },
	locale: 'en-US',
})

console.log(`Navigating to ${url}...`)
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })

// Close the cookie banner and the sign-in prompt, so they don't end up in the
// file. Playwright ignores the `isVisible` timeout, so only a banner that is
// visible now gets closed.
for (const sel of [
	'[id="onetrust-accept-btn-handler"]',
	'button[aria-label="Dismiss sign-in info."]',
]) {
	try {
		const el = page.locator(sel).first()
		if (await el.isVisible({ timeout: 2000 })) await el.click()
	} catch {
		// A banner that won't close stays in the file, and the trim removes it
	}
}

// 2 more seconds, so content that arrives after `networkidle` is in the file
await new Promise((r) => setTimeout(r, 2000))

const html = await page.content()
// The scraper tests serve this folder as `/hotel/`, where property pages live
const outPath = join(__dirname, 'fixtures', 'hotel', `${name}.html`)
writeFileSync(outPath, html, 'utf-8')
console.log(`Saved to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)

await browser.close()
