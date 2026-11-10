import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, 'fixtures')

// Dynamically import scraper only if Playwright is available
let scrapeAvailability
let chromium
let playwrightAvailable = false
try {
	const mod = await import('../src/scraper.mjs')
	scrapeAvailability = mod.scrapeAvailability
	;({ chromium } = await import('playwright'))
	playwrightAvailable = true
} catch {
	console.log('Playwright not available, skipping scraper tests')
}

/**
 * Decides what the server sends for a path, as Booking would. Most paths serve
 * the fixture file of the same path.
 *
 * @param {URL} url
 * @returns {{ redirect: string } | { file: string } | { hangUp: true }} What
 *   to send. `hangUp` closes the connection with no answer.
 */
function route({ pathname, searchParams }) {
	// A renamed property: Booking sends the old slug to the new one
	if (pathname === '/hotel/old-name.html') {
		return { redirect: '/hotel/available.html' }
	}
	// Has rooms on Jul 1, then goes to a city page on later dates
	if (pathname === '/hotel/city-after-first.html') {
		const isFirstDate = searchParams.get('checkin') === '2026-07-01'
		return { file: isFirstDate ? 'hotel/available.html' : 'hotel/missing.html' }
	}
	// Closes the connection, so the page fails to load
	if (pathname === '/hotel/hang-up.html') return { hangUp: true }
	return { file: pathname.slice(1) }
}

// Local HTTP server to serve fixtures. It keeps the URL and user agent of each
// request, so a test can count page loads. Each test starts a new browser
// session, and like Booking, the server answers the first page of a session
// with 202. So a scraper that reads the status fails the tests.
let server
let baseUrl
let requests
let userAgents

before(async () => {
	if (!playwrightAvailable) return

	server = createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost')
		requests.push(url)
		userAgents.push(req.headers['user-agent'])
		const answer = route(url)
		if (answer.hangUp) {
			req.socket.destroy()
			return
		}
		if (answer.redirect) {
			res.writeHead(301, { Location: answer.redirect })
			res.end()
			return
		}
		try {
			const content = readFileSync(join(fixturesDir, answer.file), 'utf-8')
			const isFirstPage = requests.length === 1
			res.writeHead(isFirstPage ? 202 : 200, { 'Content-Type': 'text/html' })
			res.end(content)
		} catch {
			res.writeHead(404)
			res.end('Not found')
		}
	})

	await new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			baseUrl = `http://127.0.0.1:${addr.port}`
			resolve()
		})
	})
})

after(() => {
	if (server) server.close()
})

beforeEach(() => {
	requests = []
	userAgents = []
})

/**
 * Builds a watchdog for a path on the fixture server, with 2 adults, no
 * children and 3 nights.
 *
 * @param {string} path Such as `/hotel/available.html`.
 * @param {object} [overrides] Values that replace the defaults.
 */
function watchdogAt(path, overrides = {}) {
	return {
		id: 'test-id',
		property_url: `${baseUrl}${path}`,
		adults: 2,
		children: 0,
		min_nights: 3,
		...overrides,
	}
}

/**
 * Scrapes one date of a fixture under `/hotel/`.
 *
 * @param {string} fixture File name without `.html`.
 */
function scrapeOneDate(fixture) {
	return scrapeAvailability(watchdogAt(`/hotel/${fixture}.html`), [
		'2026-07-01',
	])
}

describe('scraper against fixtures', {
	skip: !playwrightAvailable && 'Playwright not available',
}, () => {
	it('detects available rooms', async () => {
		assert.deepEqual(await scrapeOneDate('available'), {
			missing: false,
			dateResults: [{ date: '2026-07-01', result: 'available' }],
		})
	})

	it('reads the no-availability message as sold out, without waiting for a room table', async () => {
		const start = performance.now()
		const result = await scrapeOneDate('sold-out')
		const seconds = (performance.now() - start) / 1000
		assert.deepEqual(result, {
			missing: false,
			dateResults: [{ date: '2026-07-01', result: 'sold-out' }],
		})
		// The wait for a room table that never comes takes 5 seconds
		assert.ok(seconds < 5, `took ${seconds.toFixed(1)} s`)
	})

	it('reads a date as available when the last room has a price and the others not', async () => {
		assert.deepEqual(await scrapeOneDate('partial-availability'), {
			missing: false,
			dateResults: [{ date: '2026-07-01', result: 'available' }],
		})
	})

	it('reads a date as sold out when every room says "not available"', async () => {
		assert.deepEqual(await scrapeOneDate('all-rooms-unavailable'), {
			missing: false,
			dateResults: [{ date: '2026-07-01', result: 'sold-out' }],
		})
	})
})

describe('unknown dates', {
	skip: !playwrightAvailable && 'Playwright not available',
}, () => {
	const unknownPages = [
		{
			page: 'a priced page under /hotel/ without the property mark',
			fixture: 'no-mark',
			reason: 'no property mark',
		},
		{
			page: 'a property page with neither a room table nor the no-availability message',
			fixture: 'no-room-table',
			reason: 'no room table or no-availability message',
		},
		{
			page: 'room rows without price cells next to the no-availability message',
			fixture: 'rows-without-prices',
			reason: 'room rows without price cells',
		},
		{
			page: 'a page that fails to load',
			fixture: 'hang-up',
			reason: 'the page failed',
		},
	]

	for (const { page, fixture, reason } of unknownPages) {
		it(`reads ${page} as unknown, and logs why`, async (t) => {
			const log = t.mock.method(console, 'log', () => {})
			t.mock.method(console, 'warn', () => {})
			assert.deepEqual(await scrapeOneDate(fixture), {
				missing: false,
				dateResults: [{ date: '2026-07-01', result: 'unknown' }],
			})
			const printed = log.mock.calls.map((call) => call.arguments[0])
			assert.ok(
				printed.includes(`  [1/1] 2026-07-01 — unknown, ${reason}`),
				printed.join('\n'),
			)
		})
	}

	it('an unknown first date does not stop the scrape', async () => {
		const result = await scrapeAvailability(watchdogAt('/hotel/no-mark.html'), [
			'2026-07-01',
			'2026-07-02',
		])
		assert.deepEqual(result, {
			missing: false,
			dateResults: [
				{ date: '2026-07-01', result: 'unknown' },
				{ date: '2026-07-02', result: 'unknown' },
			],
		})
	})
})

describe('missing property', {
	skip: !playwrightAvailable && 'Playwright not available',
}, () => {
	const hotelPageLoads = () =>
		requests.filter(({ pathname }) => pathname.startsWith('/hotel/')).length

	it('stops after the first date when its page settles outside /hotel/', async () => {
		const result = await scrapeAvailability(watchdogAt('/hotel/missing.html'), [
			'2026-07-01',
			'2026-07-02',
			'2026-07-03',
		])
		assert.deepEqual(result, {
			missing: true,
			finalUrl: `${baseUrl}/city/test-town.html`,
		})
		assert.equal(hotelPageLoads(), 1)
	})

	it('a later date that settles outside /hotel/ is unknown, and the property is not missing', async () => {
		const result = await scrapeAvailability(
			watchdogAt('/hotel/city-after-first.html'),
			['2026-07-01', '2026-07-02'],
		)
		assert.deepEqual(result, {
			missing: false,
			dateResults: [
				{ date: '2026-07-01', result: 'available' },
				{ date: '2026-07-02', result: 'unknown' },
			],
		})
	})

	it('a renamed slug under /hotel/ is not missing', async () => {
		assert.deepEqual(await scrapeOneDate('old-name'), {
			missing: false,
			dateResults: [{ date: '2026-07-01', result: 'available' }],
		})
	})
})

describe('what each page asks Booking', {
	skip: !playwrightAvailable && 'Playwright not available',
}, () => {
	it('asks for the stay and guests of the watchdog, each child aged 13, and nothing from a pasted URL', async () => {
		// A pasted search URL carries its own guests, which Booking would use
		const pastedUrl =
			'/hotel/available.html?room1=A%2CA%2CA%2CA&req_adults=4&sid=old'
		const watchdog = watchdogAt(pastedUrl, {
			adults: 3,
			children: 2,
			min_nights: 4,
		})
		await scrapeAvailability(watchdog, ['2026-07-01'])
		const askedFor = [...requests[0].searchParams].sort()
		assert.deepEqual(askedFor, [
			// One age for each child, because Booking doesn't count a child without
			['age', '13'],
			['age', '13'],
			['checkin', '2026-07-01'],
			['checkout', '2026-07-05'],
			['group_adults', '3'],
			['group_children', '2'],
			// The scraper reads English text, so every page asks for English.
			// Without `lang`, Booking serves a `.de.html` URL in German.
			['lang', 'en-gb'],
			['no_rooms', '1'],
		])
	})

	it('names the Chrome version and system that run it, without Headless', async () => {
		const browser = await chromium.launch()
		const majorVersion = browser.version().split('.')[0]
		await browser.close()

		await scrapeOneDate('available')
		const [userAgent] = userAgents
		assert.doesNotMatch(userAgent, /Headless/)
		assert.match(userAgent, new RegExp(` Chrome/${majorVersion}\\.0\\.0\\.0 `))
		const system = process.platform === 'darwin' ? 'Macintosh' : 'Linux'
		assert.match(userAgent, new RegExp(system))
	})
})
