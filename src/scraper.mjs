/**
 * Playwright scraper for Booking.com availability.
 * Per-date probing: loads each date individually, checks room table for availability.
 */
import { chromium } from 'playwright'

function dateRange(start, end) {
	const dates = []
	const d = new Date(`${start}T00:00:00Z`)
	const last = new Date(`${end}T00:00:00Z`)
	while (d <= last) {
		dates.push(d.toISOString().slice(0, 10))
		d.setUTCDate(d.getUTCDate() + 1)
	}
	return dates
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

function randomDelay(min = 1500, max = 3500) {
	return sleep(min + Math.random() * (max - min))
}

const UNAVAIL_PATTERNS = ['not available', 'prices are not available']

async function dismissBanners(page) {
	const selectors = [
		'[id="onetrust-accept-btn-handler"]',
		'button[aria-label="Dismiss sign-in info."]',
		'[data-testid="close-button"]',
	]
	for (const sel of selectors) {
		try {
			const el = page.locator(sel).first()
			if (await el.isVisible({ timeout: 500 })) await el.click()
		} catch {
			// ignore
		}
	}
}

async function checkDate(page, propertyUrl, date, adults, children, minNights) {
	const checkoutDate = new Date(`${date}T00:00:00Z`)
	checkoutDate.setUTCDate(checkoutDate.getUTCDate() + minNights)
	const checkout = checkoutDate.toISOString().slice(0, 10)

	const url = new URL(propertyUrl)
	url.searchParams.set('checkin', date)
	url.searchParams.set('checkout', checkout)
	url.searchParams.set('group_adults', String(adults))
	url.searchParams.set('group_children', String(children))
	url.searchParams.set('no_rooms', '1')

	await page.goto(url.toString(), {
		waitUntil: 'domcontentloaded',
		timeout: 30000,
	})
	await dismissBanners(page)

	// Wait for room table to render (JS-hydrated), fall back to timeout
	try {
		await page.waitForSelector('.hprt-table', { timeout: 5000 })
	} catch {
		// Table didn't appear — page may be blocked or property fully sold out
	}

	// Check room table rows for per-room availability
	const rows = await page.$$('.hprt-table tr')

	if (rows.length > 0) {
		// Per-row: at least one row's price cell must not say "not available"
		for (const row of rows) {
			const priceCell = await row.$('.hprt-table-cell-price')
			if (!priceCell) continue
			const text = (await priceCell.innerText()).toLowerCase()
			if (!UNAVAIL_PATTERNS.some((p) => text.includes(p))) return true
		}
		return false
	}

	// No table rows — treat as sold out
	return false
}

export async function scrapeAvailability(
	propertyUrl,
	checkinDate,
	checkoutDate,
	adults,
	children,
	minNights = 1,
) {
	const browser = await chromium.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})

	try {
		const context = await browser.newContext({
			userAgent:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			viewport: { width: 1280, height: 900 },
			locale: 'en-US',
		})
		const page = await context.newPage()
		const allDates = dateRange(checkinDate, checkoutDate)
		const results = []

		console.log(`Scraping ${allDates.length} dates...`)

		for (const date of allDates) {
			try {
				const available = await checkDate(
					page,
					propertyUrl,
					date,
					adults,
					children,
					minNights,
				)
				results.push({ date, available })
				console.log(
					`  [${results.length}/${allDates.length}] ${date} — ${available ? 'available' : 'sold out'}`,
				)
			} catch (err) {
				console.warn(`Failed to check ${date}: ${err.message}`)
				results.push({ date, available: false })
				console.log(`  [${results.length}/${allDates.length}] ${date} — error`)
			}

			await randomDelay()
		}

		console.log(`Scraping completed: ${results.length} dates`)
		return results
	} finally {
		await browser.close()
	}
}
