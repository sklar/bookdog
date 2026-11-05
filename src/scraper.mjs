/**
 * Asks Booking if a property has rooms, with one page load per check-in date.
 * Up to `CONCURRENCY` Playwright pages share the dates.
 */
import { chromium } from 'playwright'
import { addDays } from './dates.mjs'

// Pages open at once, to fit a long window inside the job timeout
const CONCURRENCY = 5

/**
 * @param {number} ms
 * @returns {Promise<void>} Resolves after `ms` milliseconds.
 */
function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * Pauses a worker between page loads, to go easy on Booking.
 *
 * @param {number} [min] Shortest pause in ms.
 * @param {number} [max] Longest pause in ms.
 * @returns {Promise<void>} Resolves after the pause.
 */
function randomDelay(min = 1500, max = 3500) {
	return sleep(min + Math.random() * (max - min))
}

// Lower-case price cell text that means a room has no offer
const UNAVAIL_PATTERNS = ['not available', 'prices are not available']

/**
 * Closes the cookie banner, the sign-in prompt or any other close button that is
 * visible now. It doesn't wait, because Playwright ignores the `isVisible`
 * timeout. A banner that appears a moment later stays open.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<void>} Resolves when each selector has had its turn.
 */
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
			// A banner that won't close doesn't stop the room table read
		}
	}
}

/**
 * Loads the property page for one check-in date and reads its room table. The
 * URL asks for a stay of `minNights`, so `true` means Booking offers that stay.
 * Throws when the page doesn't load, with a limit of 30 seconds.
 *
 * @param {import('playwright').Page} page
 * @param {string} propertyUrl
 * @param {string} date Check-in date, `YYYY-MM-DD`.
 * @param {number} adults
 * @param {number} children
 * @param {number} minNights
 * @returns {Promise<boolean>} `true` when a price cell lacks the "not available"
 *   text.
 */
async function checkDate(page, propertyUrl, date, adults, children, minNights) {
	const url = new URL(propertyUrl)
	url.searchParams.set('checkin', date)
	url.searchParams.set('checkout', addDays(date, minNights))
	url.searchParams.set('group_adults', String(adults))
	url.searchParams.set('group_children', String(children))
	url.searchParams.set('no_rooms', '1')

	await page.goto(url.toString(), {
		waitUntil: 'domcontentloaded',
		timeout: 30000,
	})
	await dismissBanners(page)

	// The room table can appear after domcontentloaded, and the first page of a
	// browser session answers 202 before it settles. So wait up to 5 seconds.
	try {
		await page.waitForSelector('.hprt-table', { timeout: 5000 })
	} catch {
		// No table in time. The row count below decides what that means.
	}

	const rows = await page.$$('.hprt-table tr')

	if (rows.length > 0) {
		// One price cell without "not available" makes the date available
		for (const row of rows) {
			const priceCell = await row.$('.hprt-table-cell-price')
			if (!priceCell) continue
			// biome-ignore lint/performance/useDomNodeTextContent: Playwright method, not the DOM property. innerText skips hidden text, which must not count as "not available"
			const text = (await priceCell.innerText()).toLowerCase()
			if (!UNAVAIL_PATTERNS.some((p) => text.includes(p))) return true
		}
		return false
	}

	// A sold out property lands here, and so do a block page and a redirect to a
	// city page. All three read as not available.
	return false
}

/**
 * Checks each date in its own page load. Workers take dates from a shared queue,
 * one worker per page, and each pauses between its loads.
 *
 * A date whose page throws comes back as not available, with a warning in the
 * log. So `available: false` doesn't always mean sold out.
 *
 * @param {string} propertyUrl
 * @param {string[]} dates Check-in dates, `YYYY-MM-DD`.
 * @param {number} adults
 * @param {number} children
 * @param {number} [minNights] Length of the stay each page asks about. Defaults
 *   to 1.
 * @returns {Promise<{ date: string, available: boolean }[]>} One result per date,
 *   sorted by date.
 */
export async function scrapeAvailability(
	propertyUrl,
	dates,
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

		const queue = [...dates]
		const results = []
		let completed = 0

		console.log(`Scraping ${dates.length} dates (${CONCURRENCY} concurrent)...`)

		const pageCount = Math.min(CONCURRENCY, dates.length)
		const pages = await Promise.all(
			Array.from({ length: pageCount }, () => context.newPage()),
		)

		const worker = async (page) => {
			while (queue.length > 0) {
				const date = queue.shift()
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
					completed++
					console.log(
						`  [${completed}/${dates.length}] ${date} — ${available ? 'available' : 'sold out'}`,
					)
				} catch (err) {
					console.warn(`Failed to check ${date}: ${err.message}`)
					results.push({ date, available: false })
					completed++
					console.log(`  [${completed}/${dates.length}] ${date} — error`)
				}

				if (queue.length > 0) await randomDelay()
			}
		}

		await Promise.all(pages.map((p) => worker(p)))

		// Workers finish in any order
		results.sort((a, b) => a.date.localeCompare(b.date))

		console.log(`Scraping completed: ${results.length} dates`)
		return results
	} finally {
		await browser.close()
	}
}
