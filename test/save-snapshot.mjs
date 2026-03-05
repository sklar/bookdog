/**
 * Dev utility: capture a Booking.com page as an HTML fixture.
 * Usage: node test/save-snapshot.mjs <url> [output-name]
 * Example: node test/save-snapshot.mjs "https://www.booking.com/hotel/it/grand-hotel-roma.html?checkin=2026-07-01&checkout=2026-07-02" available
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))

const url = process.argv[2]
const name = process.argv[3] || 'snapshot'

if (!url) {
	console.error('Usage: node test/save-snapshot.mjs <url> [output-name]')
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

// Dismiss banners
for (const sel of [
	'[id="onetrust-accept-btn-handler"]',
	'button[aria-label="Dismiss sign-in info."]',
]) {
	try {
		const el = page.locator(sel).first()
		if (await el.isVisible({ timeout: 2000 })) await el.click()
	} catch {
		/* ignore */
	}
}

await new Promise((r) => setTimeout(r, 2000))

const html = await page.content()
const outPath = join(__dirname, 'fixtures', `${name}.html`)
writeFileSync(outPath, html, 'utf-8')
console.log(`Saved to ${outPath} (${(html.length / 1024).toFixed(1)} KB)`)

await browser.close()
