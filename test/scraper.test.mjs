import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, 'fixtures')

// Dynamically import scraper only if Playwright is available
let scrapeAvailability
let playwrightAvailable = false
try {
	const mod = await import('../src/scraper.mjs')
	scrapeAvailability = mod.scrapeAvailability
	playwrightAvailable = true
} catch {
	console.log('Playwright not available, skipping scraper tests')
}

// Local HTTP server to serve fixtures
let server
let baseUrl

before(async () => {
	if (!playwrightAvailable) return

	server = createServer((req, res) => {
		const pathname = new URL(req.url, 'http://localhost').pathname
		const filePath = join(fixturesDir, pathname.slice(1))
		try {
			const content = readFileSync(filePath, 'utf-8')
			res.writeHead(200, { 'Content-Type': 'text/html' })
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

describe(
	'scraper against fixtures',
	{ skip: !playwrightAvailable && 'Playwright not available' },
	() => {
		it('detects available rooms', async () => {
			const result = await scrapeAvailability(
				`${baseUrl}/available.html`,
				'2026-07-01',
				'2026-07-01',
				2,
				0,
			)
			assert.equal(result.length, 1)
			assert.equal(result[0].available, true)
		})

		it('detects sold out property', async () => {
			const result = await scrapeAvailability(
				`${baseUrl}/sold-out.html`,
				'2026-07-01',
				'2026-07-01',
				2,
				0,
			)
			assert.equal(result.length, 1)
			assert.equal(result[0].available, false)
		})

		it('detects partial availability (some rooms unavailable)', async () => {
			const result = await scrapeAvailability(
				`${baseUrl}/partial-availability.html`,
				'2026-07-01',
				'2026-07-01',
				2,
				0,
			)
			assert.equal(result.length, 1)
			assert.equal(result[0].available, true)
		})

		it('detects all rooms unavailable', async () => {
			const result = await scrapeAvailability(
				`${baseUrl}/all-rooms-unavailable.html`,
				'2026-07-01',
				'2026-07-01',
				2,
				0,
			)
			assert.equal(result.length, 1)
			assert.equal(result[0].available, false)
		})
	},
)
