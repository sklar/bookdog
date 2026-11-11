/**
 * Asks Booking if a property has rooms, with one page load per check-in date.
 * Each date comes back available, sold out or unknown, and sold out needs proof
 * from the page.
 *
 * The first date loads alone, then up to `CONCURRENCY` Playwright pages share
 * the other dates. A few unknown dates get a second try.
 */
import { chromium } from 'playwright'
import { buildBookingUrl } from './booking.mjs'
import { addDays } from './dates.mjs'
import { isTooManyUnknown } from './unknown-dates.mjs'

/**
 * Pages open at once. A window of 500 days needs 500 page loads, plus up to 50
 * on the second try, and fits inside the job limit of 15 minutes.
 *
 * Timeouts can break that. 50 page loads that each time out after 30 seconds
 * take about 5 minutes, once in the first pass and again on the second try.
 */
const CONCURRENCY = 5

/**
 * Waits for `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>} Resolves after the wait.
 */
function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

/**
 * Pauses a worker between its page loads, so the pages don't send Booking
 * requests back to back. `scrapeAvailability` uses it unless a test passes its
 * own `pause`.
 *
 * @param {number} [min] Shortest pause in ms.
 * @param {number} [max] Longest pause in ms.
 * @returns {Promise<void>} Resolves after the pause.
 */
function randomDelay(min = 1500, max = 3500) {
	return sleep(min + Math.random() * (max - min))
}

/**
 * Lower-case price cell text that means a room has no offer, such as "Not
 * available for your dates" and "Prices are not available".
 *
 * It's English, so every page loads in `PAGE_LANGUAGE`.
 */
const UNAVAIL_PATTERNS = ['not available']

/**
 * Language of every page the scraper loads.
 *
 * Booking serves a `.de.html` URL in German, where a room with no offer lacks
 * the English text and would read as available. With `lang=en-gb`, Booking
 * sends the browser to the `.en-gb.html` page instead.
 */
const PAGE_LANGUAGE = 'en-gb'

// Selectors for the parts of a Booking page that decide a date result. The wait
// and the reads below share them. If Booking changes its pages, update them
// here and in the fixtures.

/**
 * Every property page has this mark. City pages and block pages don't.
 *
 * So `checkDate` checks the mark and the `/hotel/` path. A city page has no
 * mark and leaves `/hotel/`. A block page has no mark either, but it can keep
 * the `/hotel/` path.
 */
const PROPERTY_MARK = 'body#b2hotelPage'
const ROOM_TABLE = '.hprt-table'
const ROOM_ROW = `${ROOM_TABLE} tr`
const PRICE_CELL = `${ROOM_ROW} .hprt-table-cell-price`

/**
 * Takes the room table's place on a date with no rooms.
 *
 * So far Booking has shown it only on dates past the booking limit, never on a
 * fully booked date.
 */
const NO_AVAILABILITY_MESSAGE = '#no_availability_msg'

/**
 * Longest wait, in ms, for a loaded page to settle. `checkDate` explains what
 * it waits for.
 *
 * Nobody has timed how long Booking takes to settle a page. A shorter wait
 * could end before the room table appears, or before a missing property's page
 * leaves `/hotel/`. Either date would read as unknown.
 */
const SETTLE_TIMEOUT_MS = 5000

/**
 * Clicks the cookie banner's accept button, the sign-in prompt's dismiss button
 * and any other close button that is visible now. `isVisible` doesn't wait, and
 * Playwright ignores a timeout passed to it. So a banner that appears a moment
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
			if (await el.isVisible()) await el.click()
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
 * A date result: `available`, `sold-out` or `unknown`.
 *
 * @typedef {import('./watchdog.mjs').DateResult['result']} Result
 */

/**
 * What one page showed.
 *
 * @typedef {object} PageRead
 * @property {Result} result
 * @property {string} [reason] Why the date is unknown, for the log.
 */

/**
 * What one page load found.
 *
 * @typedef {PageRead & { finalUrl: string | null }} PageResult `finalUrl` is
 *   where the page settled, `null` when the page threw.
 */

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
 * Tells whether a price cell's text says that its room has no offer.
 *
 * @param {string} text Inner text of the cell.
 * @returns {boolean} `true` when it has one of `UNAVAIL_PATTERNS`.
 */
function saysNotAvailable(text) {
	const lowerText = text.toLowerCase()
	return UNAVAIL_PATTERNS.some((p) => lowerText.includes(p))
}

/**
 * Reads the date result from a loaded property page:
 *
 * - One price cell without the "not available" text is an offer, and one offer
 *   makes the date available.
 * - Every price cell with that text makes it sold out.
 * - So does the no-availability message on a page with no room table rows.
 * - Anything else is unknown.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<PageRead>} The date result, with a reason when it's
 *   unknown.
 */
async function readPropertyPage(page) {
	// One browser call reads every price cell. Inner text skips hidden text,
	// which must not count as "not available".
	const priceTexts = await page.locator(PRICE_CELL).allInnerTexts()

	const hasOffer = priceTexts.some((text) => !saysNotAvailable(text))
	if (hasOffer) return { result: 'available' }
	if (priceTexts.length > 0) return { result: 'sold-out' }

	// Booking has shown the message only on pages without a room table. Room rows
	// without price cells mean Booking changed the page, and the message next to
	// them proves nothing. A table with only a header row counts as rows.
	const rowCount = await page.locator(ROOM_ROW).count()
	if (rowCount > 0) {
		return { result: 'unknown', reason: 'room rows without price cells' }
	}

	const hasNoAvailabilityMessage =
		(await page.locator(NO_AVAILABILITY_MESSAGE).count()) > 0
	if (hasNoAvailabilityMessage) return { result: 'sold-out' }

	return {
		result: 'unknown',
		reason: 'no room table or no-availability message',
	}
}

/**
 * Loads the English property page for one check-in date and reads its date
 * result.
 *
 * The URL asks for a stay of the watchdog's minimum nights for its guests, so
 * `available` means Booking offers that stay to them. A page that settles
 * outside `/hotel/` or lacks `PROPERTY_MARK` isn't a property page, and its
 * date is unknown.
 *
 * Throws when the page doesn't load within 30 seconds.
 *
 * @param {import('playwright').Page} page
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults`,
 *   `children` and `min_nights` filled in.
 * @param {string} date Check-in date, `YYYY-MM-DD`.
 * @returns {Promise<PageResult>} Where the page settled, and its date result
 *   with a reason when it's unknown.
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
	// up to `SETTLE_TIMEOUT_MS` for the table, or for the no-availability
	// message that replaces it on a date with no rooms.
	//
	// The wait also ends when the page leaves `/hotel/`, as a missing property's
	// page does on its way to a city page. Such a page reads as missing or
	// unknown however long it waits. This assumes that Booking never sends a
	// page away from `/hotel/` and back, which no probe has shown.
	//
	// A page that has neither and stays under `/hotel/` waits the full
	// `SETTLE_TIMEOUT_MS`. The wait that loses keeps running until its own
	// timeout. That does no harm, and `Promise.any` handles its rejection.
	const waits = [
		page.waitForSelector(`${ROOM_TABLE}, ${NO_AVAILABILITY_MESSAGE}`, {
			timeout: SETTLE_TIMEOUT_MS,
		}),
		page.waitForURL((url) => !isUnderHotelPath(url.href), {
			timeout: SETTLE_TIMEOUT_MS,
			waitUntil: 'commit',
		}),
	]
	await Promise.any(waits).catch(() => {
		// Neither in time. The reads below decide what that means.
	})

	// Read after the wait, because a page that settles can move to another URL.
	// Nothing reads the HTTP status. Booking answers the first page of a session
	// with 202, whether the property is there or missing.
	const finalUrl = page.url()
	if (!isUnderHotelPath(finalUrl)) {
		return { finalUrl, result: 'unknown', reason: `sent to ${finalUrl}` }
	}
	const hasMark = (await page.locator(PROPERTY_MARK).count()) > 0
	if (!hasMark) {
		return { finalUrl, result: 'unknown', reason: 'no property mark' }
	}
	return { finalUrl, ...(await readPropertyPage(page)) }
}

/**
 * Describes one loaded date for its log line.
 *
 * @param {PageRead} pageRead
 * @returns {string} Such as `sold out` or `unknown, no property mark`.
 */
function describeDate({ result, reason }) {
	const words = result === 'sold-out' ? 'sold out' : result
	return reason ? `${words}, ${reason}` : words
}

/**
 * Checks each date in its own page load. The first date loads alone. If its
 * page settles outside `/hotel/`, the property is missing and the scrape stops
 * there. Otherwise workers take the other dates from a shared queue, one worker
 * per page, and each pauses between its loads.
 *
 * A later date that settles outside `/hotel/` comes back unknown, and the
 * property isn't missing. A date whose page throws is unknown too, and the log
 * gets a warning. An unknown first date doesn't stop the scrape.
 *
 * After this first pass, the unknown dates load once more, and the new result
 * replaces the old one. `isTooManyUnknown` stops that when more than 10% are
 * unknown, because Booking may be blocking the scraper. A date that settles
 * outside `/hotel/` on its second try stays unknown, even the first date.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults`,
 *   `children` and `min_nights` filled in.
 * @param {string[]} dates Check-in dates, `YYYY-MM-DD`. At least one.
 * @param {object} [options] Only tests pass it.
 * @param {() => Promise<void>} [options.pause] Waits between two loads of one
 *   page. Defaults to `randomDelay`. Tests pass one that returns at once.
 * @returns {Promise<import('./watchdog.mjs').ScrapeResult>} Missing with the
 *   final URL, or one result per date, sorted by date.
 */
export async function scrapeAvailability(
	watchdog,
	dates,
	{ pause = randomDelay } = {},
) {
	// Playwright adds `--no-sandbox` unless `chromiumSandbox` is true, so this
	// launch needs no sandbox flags
	const browser = await chromium.launch({ headless: true })

	try {
		const context = await browser.newContext({
			userAgent: await desktopUserAgent(browser),
			viewport: { width: 1280, height: 900 },
			locale: 'en-US',
		})

		/**
		 * Builds the logger for one pass. It numbers each loaded date within that
		 * pass, such as `[second try 1/2]`.
		 *
		 * @param {number} total Dates in the pass.
		 * @param {string} [label] Goes before the count, such as `second try `.
		 * @returns {(date: string, words: string) => void} Logs one loaded date.
		 *   `words` come from `describeDate`, such as `sold out`.
		 */
		const progressLog = (total, label = '') => {
			let completed = 0
			return (date, words) => {
				completed++
				console.log(`  [${label}${completed}/${total}] ${date} — ${words}`)
			}
		}

		/**
		 * Loads one date and logs what it found. A page that throws is unknown,
		 * with no final URL, so `loadDate` itself never throws.
		 *
		 * @param {import('playwright').Page} page
		 * @param {string} date
		 * @param {(date: string, words: string) => void} logProgress From
		 *   `progressLog`.
		 * @returns {Promise<PageResult>} Where the page settled, and its date
		 *   result.
		 */
		const loadDate = async (page, date, logProgress) => {
			const pageResult = await checkDate(page, watchdog, date).catch((err) => {
				console.warn(`Failed to check ${date}: ${err.message}`)
				return /** @type {PageResult} */ ({
					finalUrl: null,
					result: 'unknown',
					reason: 'the page failed',
				})
			})
			logProgress(date, describeDate(pageResult))
			return pageResult
		}

		console.log(`Scraping ${dates.length} dates (${CONCURRENCY} concurrent)...`)
		const logFirstPass = progressLog(dates.length)

		// The first date loads alone, so a missing property costs one page load
		const [firstDate, ...laterDates] = dates
		const firstPage = await context.newPage()
		const firstPageResult = await loadDate(firstPage, firstDate, logFirstPass)
		const { finalUrl } = firstPageResult
		const isMissing = finalUrl !== null && !isUnderHotelPath(finalUrl)
		if (isMissing) {
			console.log('Scraping stopped: the property is missing')
			return { missing: true, finalUrl }
		}

		const pages = [firstPage]
		const pageCount = Math.min(CONCURRENCY, laterDates.length)
		while (pages.length < pageCount) pages.push(await context.newPage())

		/**
		 * Loads the dates on the open pages, one worker per page. Workers take
		 * dates from a shared queue, and each pauses between its loads.
		 *
		 * @param {string[]} passDates Dates of this pass.
		 * @param {(date: string, words: string) => void} logProgress From
		 *   `progressLog`.
		 * @returns {Promise<import('./watchdog.mjs').DateResult[]>} One result
		 *   per date, in the order the loads finished.
		 */
		const loadOnPages = async (passDates, logProgress) => {
			const queue = [...passDates]
			const passResults = []
			const worker = async (page) => {
				while (queue.length > 0) {
					const date = queue.shift()
					const { result } = await loadDate(page, date, logProgress)
					passResults.push({ date, result })
					if (queue.length > 0) await pause()
				}
			}
			await Promise.all(pages.map((p) => worker(p)))
			return passResults
		}

		/**
		 * Loads the unknown dates once more on the open pages. The new result
		 * replaces the old one, so one slow page doesn't break a stretch.
		 *
		 * There's no pause first. The workers of the first pass also start right
		 * after a load, and the second try has at most a tenth of the dates.
		 *
		 * @param {string[]} unknownDates Dates the first pass left unknown.
		 * @param {import('./watchdog.mjs').DateResult[]} firstPassResults
		 * @returns {Promise<import('./watchdog.mjs').DateResult[]>} The results
		 *   of the first pass, with the new result for each date tried again.
		 */
		const tryAgain = async (unknownDates, firstPassResults) => {
			console.log(`Second try for ${unknownDates.length} unknown dates...`)
			const secondTryResults = await loadOnPages(
				unknownDates,
				progressLog(unknownDates.length, 'second try '),
			)
			const secondResults = new Map(
				secondTryResults.map(({ date, result }) => [date, result]),
			)
			return firstPassResults.map(({ date, result }) => ({
				date,
				result: secondResults.get(date) ?? result,
			}))
		}

		const firstPassResults = [
			{ date: firstDate, result: firstPageResult.result },
			...(await loadOnPages(laterDates, logFirstPass)),
		]

		const unknownDates = firstPassResults
			.filter(({ result }) => result === 'unknown')
			.map(({ date }) => date)
		const shouldTryAgain =
			unknownDates.length > 0 && !isTooManyUnknown(firstPassResults)

		// Workers finish in any order
		const dateResults = (
			shouldTryAgain
				? await tryAgain(unknownDates, firstPassResults)
				: firstPassResults
		).toSorted((a, b) => a.date.localeCompare(b.date))

		console.log(`Scraping completed: ${dateResults.length} dates`)
		return { missing: false, dateResults }
	} finally {
		await browser.close()
	}
}
