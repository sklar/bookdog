/**
 * Asks Booking if a property has rooms, with one page load per check-in date.
 * The first date loads alone, then up to `CONCURRENCY` Playwright pages share
 * the other dates.
 */
import { chromium } from 'playwright'
import { buildBookingUrl } from './booking.mjs'
import { addDays } from './dates.mjs'

// Pages open at once, so a window of 500 days, about 500 page loads, fits
// inside the job limit of 15 minutes
const CONCURRENCY = 5

/**
 * @param {number} ms
 * @returns {Promise<void>} Resolves after `ms` milliseconds.
 */
function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * Pauses a worker between its page loads, so the pages don't send Booking
 * requests back to back.
 *
 * @param {number} [min] Shortest pause in ms.
 * @param {number} [max] Longest pause in ms.
 * @returns {Promise<void>} Resolves after the pause.
 */
function randomDelay(min = 1500, max = 3500) {
	return sleep(min + Math.random() * (max - min))
}

// Lower-case price cell text that means a room has no offer. It's English, so
// every page loads in `PAGE_LANGUAGE`.
const UNAVAIL_PATTERNS = ['not available', 'prices are not available']

// Booking serves a `.de.html` URL in German, where a room with no offer lacks
// the English text and would read as available. With `lang=en-gb`, Booking
// moves to the `.en-gb.html` page instead.
const PAGE_LANGUAGE = 'en-gb'

/**
 * Clicks the cookie banner's accept button, the sign-in prompt's dismiss button
 * and any other close button that is visible now. It doesn't wait, because
 * Playwright ignores the `isVisible` timeout. A banner that appears a moment
 * later stays open.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<void>} Resolves after each selector was tried.
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
 * Builds the user agent of desktop Chrome, with the version and system of the
 * Chromium that runs. Desktop Chrome sends `Chrome/156.0.0.0`, and headless
 * Chromium sends `HeadlessChrome/156.0.8078.4`. On 2026-11-10, Booking answered
 * the headless one with pages that had no room table and ignored the guests.
 * Every date would then read as not available.
 *
 * A page can still find `HeadlessChrome` in `navigator.userAgentData`. This
 * doesn't hide it.
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<string>} Such as `… Chrome/156.0.0.0 Safari/537.36`.
 */
async function desktopUserAgent(browser) {
	const session = await browser.newBrowserCDPSession()
	const { userAgent } = await session.send('Browser.getVersion')
	await session.detach()
	return userAgent.replace(/HeadlessChrome\/(\d+)[\d.]*/, 'Chrome/$1.0.0.0')
}

/**
 * Tells whether a URL is under `/hotel/`, where Booking keeps every property
 * page. A renamed property stays there. A missing one goes elsewhere, such as a
 * city page.
 *
 * @param {string} url
 * @returns {boolean} `true` when the path starts with `/hotel/`.
 */
function isUnderHotelPath(url) {
	return new URL(url).pathname.startsWith('/hotel/')
}

/**
 * Reads the room table of the loaded page. One price cell without the "not
 * available" text is an offer, and one offer makes the date available.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} `true` when the page has an offer.
 */
async function readRoomTable(page) {
	// One browser call reads every price cell. Inner text skips hidden text,
	// which must not count as "not available".
	const priceTexts = await page
		.locator('.hprt-table tr .hprt-table-cell-price')
		.allInnerTexts()

	const hasOffer = priceTexts.some((text) => {
		const lowerText = text.toLowerCase()
		return !UNAVAIL_PATTERNS.some((p) => lowerText.includes(p))
	})

	// A sold out property has no offer, and neither do a block page and a later
	// date that Booking sends to a city page. All three read as not available.
	return hasOffer
}

/**
 * Loads the English property page for one check-in date and reads its room
 * table. The URL asks for a stay of the watchdog's minimum nights for its
 * guests, so `available` means Booking offers that stay to them. Throws when
 * the page doesn't load within 30 seconds.
 *
 * @param {import('playwright').Page} page
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults`,
 *   `children` and `min_nights` filled in.
 * @param {string} date Check-in date, `YYYY-MM-DD`.
 * @returns {Promise<{ finalUrl: string, available: boolean }>} Where the page
 *   settled, and whether it has an offer.
 */
async function checkDate(page, watchdog, date) {
	const url = buildBookingUrl(watchdog.property_url, {
		checkin: date,
		checkout: addDays(date, watchdog.min_nights),
		adults: watchdog.adults,
		children: watchdog.children,
		lang: PAGE_LANGUAGE,
	})

	await page.goto(url, {
		waitUntil: 'domcontentloaded',
		timeout: 30000,
	})
	await dismissBanners(page)

	// The room table can appear after domcontentloaded, and Booking answers the
	// first page of a browser session with 202 before the page settles. So wait
	// up to 5 seconds for the table, or for the no-availability message that
	// replaces it on a date with no rooms. A missing property's page has
	// neither, so the full wait runs, and Booking moves the page to a city page
	// within it.
	try {
		await page.waitForSelector('.hprt-table, #no_availability_msg', {
			timeout: 5000,
		})
	} catch {
		// Neither in time. `readRoomTable` decides what that means.
	}

	// Read after the wait, because a page that settles can move to another URL.
	// Nothing reads the HTTP status. Booking answers the first page of a session
	// with 202, whether the property is there or missing.
	const finalUrl = page.url()
	const available = await readRoomTable(page)
	return { finalUrl, available }
}

/**
 * Describes one loaded date for its log line.
 *
 * @param {{ finalUrl: string, available: boolean }} pageResult From
 *   `checkDate`.
 * @returns {string} The words.
 */
function describeDate({ finalUrl, available }) {
	if (!isUnderHotelPath(finalUrl)) return `sent to ${finalUrl}`
	return available ? 'available' : 'sold out'
}

/**
 * Checks each date in its own page load. The first date loads alone. If its
 * page settles outside `/hotel/`, the property is missing and the scrape stops
 * there. Otherwise workers take the other dates from a shared queue, one worker
 * per page, and each pauses between its loads.
 *
 * A later date that settles outside `/hotel/` doesn't make the property
 * missing. It comes back as not available, and so does a date whose page
 * throws, with a warning in the log. So `available: false` doesn't always mean
 * sold out. A first date whose page throws isn't missing either, and the scrape
 * goes on.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults`,
 *   `children` and `min_nights` filled in.
 * @param {string[]} dates Check-in dates, `YYYY-MM-DD`. At least one.
 * @returns {Promise<import('./watchdog.mjs').ScrapeResult>} Missing with the
 *   final URL, or one result per date, sorted by date.
 */
export async function scrapeAvailability(watchdog, dates) {
	// Playwright adds `--no-sandbox` unless `chromiumSandbox` is true, so this
	// launch needs no sandbox flags
	const browser = await chromium.launch({ headless: true })

	try {
		const context = await browser.newContext({
			userAgent: await desktopUserAgent(browser),
			viewport: { width: 1280, height: 900 },
			locale: 'en-US',
		})

		let completed = 0

		/**
		 * Logs one loaded date, with how many of the dates are done.
		 *
		 * @param {string} date
		 * @param {string} words What the page showed.
		 */
		const logProgress = (date, words) => {
			completed++
			console.log(`  [${completed}/${dates.length}] ${date} — ${words}`)
		}

		/**
		 * Loads one date and logs what it found. A page that throws reads as not
		 * available, with no final URL.
		 *
		 * @param {import('playwright').Page} page
		 * @param {string} date
		 * @returns {Promise<{ finalUrl: string | null, available: boolean }>}
		 */
		const loadDate = async (page, date) => {
			try {
				const pageResult = await checkDate(page, watchdog, date)
				logProgress(date, describeDate(pageResult))
				return pageResult
			} catch (err) {
				console.warn(`Failed to check ${date}: ${err.message}`)
				logProgress(date, 'error')
				return { finalUrl: null, available: false }
			}
		}

		console.log(`Scraping ${dates.length} dates (${CONCURRENCY} concurrent)...`)

		// The first date loads alone, so a missing property costs one page load
		const [firstDate, ...laterDates] = dates
		const firstPage = await context.newPage()
		const firstResult = await loadDate(firstPage, firstDate)
		const isMissing =
			firstResult.finalUrl !== null && !isUnderHotelPath(firstResult.finalUrl)
		if (isMissing) {
			console.log('Scraping stopped: the property is missing')
			return { missing: true, finalUrl: firstResult.finalUrl }
		}

		const results = [{ date: firstDate, available: firstResult.available }]
		const queue = [...laterDates]
		const pages = [firstPage]
		const pageCount = Math.min(CONCURRENCY, laterDates.length)
		while (pages.length < pageCount) pages.push(await context.newPage())

		const worker = async (page) => {
			while (queue.length > 0) {
				const date = queue.shift()
				const { available } = await loadDate(page, date)
				results.push({ date, available })
				if (queue.length > 0) await randomDelay()
			}
		}

		await Promise.all(pages.map((p) => worker(p)))

		// Workers finish in any order
		results.sort((a, b) => a.date.localeCompare(b.date))

		console.log(`Scraping completed: ${results.length} dates`)
		return { missing: false, dateResults: results }
	} finally {
		await browser.close()
	}
}
