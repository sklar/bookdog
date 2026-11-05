import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { json } from 'node:stream/consumers'
import { after, before, beforeEach, describe, it } from 'node:test'
import { runWatchdog } from '../src/check.mjs'

const WATCHDOG = {
	id: 'test-id',
	name: 'Test Property',
	property_url: 'https://www.booking.com/hotel/xx/test-property.html',
	checkin_date: '2026-07-01',
	checkout_date: '2026-07-08',
	adults: 2,
	children: 1,
	min_nights: 3,
}

const FIVE_NIGHTS = [
	'2026-07-01',
	'2026-07-02',
	'2026-07-03',
	'2026-07-04',
	'2026-07-05',
]
const FIVE_NIGHT_RUN = { start: '2026-07-01', end: '2026-07-05', nights: 5 }
const STRETCH_MESSAGE = [
	'*Test Property*',
	'test-id',
	'',
	'Found availability:',
	'• <https://www.booking.com/hotel/xx/test-property.html?checkin=2026-07-01&checkout=2026-07-06&group_adults=2&group_children=1&no_rooms=1|2026-07-01 → 2026-07-05> 5 nights',
].join('\n')

function fakeScrape(availableDates = []) {
	const calls = []
	const scrape = async (propertyUrl, dates, adults, children, minNights) => {
		calls.push({ propertyUrl, dates, adults, children, minNights })
		return dates.map((date) => ({
			date,
			available: availableDates.includes(date),
		}))
	}
	return Object.assign(scrape, { calls })
}

function memoryState(rows = {}) {
	const writes = []
	return {
		writes,
		read: async (id) =>
			structuredClone(rows[id]) ?? {
				rowIndex: null,
				lastChecked: null,
				alertedRuns: [],
			},
		write: async (id, state) => {
			writes.push({ id, ...structuredClone(state) })
		},
	}
}

// Local stand-in for the Slack webhook, records each message text
let slackServer
let slackUrl
let slackMessages
let slackStatus

before(async () => {
	slackServer = createServer(async (req, res) => {
		const { text } = await json(req)
		slackMessages.push(text)
		res.writeHead(slackStatus)
		res.end(slackStatus === 200 ? 'ok' : 'nope')
	})
	await new Promise((resolve) => slackServer.listen(0, '127.0.0.1', resolve))
	slackUrl = `http://127.0.0.1:${slackServer.address().port}`
})

after(() => {
	slackServer.close()
})

beforeEach(() => {
	slackMessages = []
	slackStatus = 200
})

function run(overrides = {}) {
	return runWatchdog({
		watchdog: WATCHDOG,
		today: '2026-06-15',
		scrape: fakeScrape(),
		stateStore: memoryState(),
		webhookUrl: slackUrl,
		isDryRun: false,
		...overrides,
	})
}

describe('dates asked for', () => {
	it('asks from the window start to the last check-in that fits when today is before the window', async () => {
		const scrape = fakeScrape()
		await run({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-10' },
			today: '2026-06-15',
			scrape,
		})
		assert.deepEqual(scrape.calls, [
			{
				propertyUrl: WATCHDOG.property_url,
				dates: [
					'2026-07-01',
					'2026-07-02',
					'2026-07-03',
					'2026-07-04',
					'2026-07-05',
					'2026-07-06',
					'2026-07-07',
				],
				adults: 2,
				children: 1,
				minNights: 3,
			},
		])
	})

	it('starts at today when today is inside the window', async () => {
		const scrape = fakeScrape()
		await run({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-10' },
			today: '2026-07-05',
			scrape,
		})
		assert.deepEqual(scrape.calls[0].dates, [
			'2026-07-05',
			'2026-07-06',
			'2026-07-07',
		])
	})

	it('asks for one date when today is the last check-in', async () => {
		const scrape = fakeScrape()
		await run({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-10' },
			today: '2026-07-07',
			scrape,
		})
		assert.deepEqual(scrape.calls[0].dates, ['2026-07-07'])
	})

	it('counts the last check-in back across a month end', async () => {
		const scrape = fakeScrape()
		await run({
			watchdog: {
				...WATCHDOG,
				checkin_date: '2026-07-29',
				checkout_date: '2026-08-02',
			},
			scrape,
		})
		assert.deepEqual(scrape.calls[0].dates, ['2026-07-29', '2026-07-30'])
	})

	it('a dry run asks for the same dates', async () => {
		const scrape = fakeScrape()
		const result = await run({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-10' },
			today: '2026-07-05',
			scrape,
			isDryRun: true,
		})
		assert.equal(result, 'green')
		assert.deepEqual(scrape.calls[0].dates, [
			'2026-07-05',
			'2026-07-06',
			'2026-07-07',
		])
	})
})

describe('finished window', () => {
	const cases = [
		{
			title: 'the window is over',
			window: { checkin_date: '2026-07-01', checkout_date: '2026-07-10' },
			today: '2026-07-11',
		},
		{
			title: 'the remaining window is too short for the minimum nights',
			window: { checkin_date: '2026-07-01', checkout_date: '2026-07-10' },
			today: '2026-07-08',
		},
		{
			title: 'the window is shorter than the minimum nights',
			window: { checkin_date: '2026-07-01', checkout_date: '2026-07-03' },
			today: '2026-06-15',
		},
		{
			title: 'the window starts and ends on the same date',
			window: { checkin_date: '2026-07-01', checkout_date: '2026-07-01' },
			today: '2026-06-15',
		},
	]

	for (const { title, window, today } of cases) {
		it(`stays green and quiet when ${title}`, async () => {
			const scrape = fakeScrape()
			const stateStore = memoryState()
			const result = await run({
				watchdog: { ...WATCHDOG, ...window },
				today,
				scrape,
				stateStore,
			})
			assert.equal(result, 'green')
			assert.deepEqual(scrape.calls, [])
			assert.deepEqual(slackMessages, [])
			assert.deepEqual(stateStore.writes, [])
		})
	}

	it('a dry run stays green and asks for no dates', async () => {
		const scrape = fakeScrape()
		const result = await run({
			watchdog: {
				...WATCHDOG,
				checkin_date: '2026-07-01',
				checkout_date: '2026-07-10',
			},
			today: '2026-07-11',
			scrape,
			isDryRun: true,
		})
		assert.equal(result, 'green')
		assert.deepEqual(scrape.calls, [])
	})
})

describe('invalid window', () => {
	const WINDOW_ERROR =
		'🚧 *Test Property*\ntest-id\n```The window has an impossible date, or its start is after its end.```'

	const cases = [
		{
			title: 'a reversed window whose dates are past',
			window: { checkin_date: '2026-05-10', checkout_date: '2026-05-01' },
		},
		{
			title: 'a start of 2026-02-30',
			window: { checkin_date: '2026-02-30', checkout_date: '2026-07-10' },
		},
		{
			title: 'an end of 2026-13-45',
			window: { checkin_date: '2026-07-01', checkout_date: '2026-13-45' },
		},
	]

	for (const { title, window } of cases) {
		it(`${title} asks for no dates, sends one error and returns red`, async () => {
			const scrape = fakeScrape()
			const stateStore = memoryState()
			const result = await run({
				watchdog: { ...WATCHDOG, ...window },
				scrape,
				stateStore,
			})
			assert.equal(result, 'red')
			assert.deepEqual(scrape.calls, [])
			assert.deepEqual(slackMessages, [WINDOW_ERROR])
			assert.deepEqual(stateStore.writes, [])
		})
	}

	it('a dry run sends no message and returns red', async () => {
		const scrape = fakeScrape()
		const stateStore = memoryState()
		const result = await run({
			watchdog: {
				...WATCHDOG,
				checkin_date: '2026-05-10',
				checkout_date: '2026-05-01',
			},
			scrape,
			stateStore,
			isDryRun: true,
		})
		assert.equal(result, 'red')
		assert.deepEqual(scrape.calls, [])
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [])
	})
})

describe('stretches', () => {
	it('a new stretch sends one message and writes state', async () => {
		const stateStore = memoryState({
			'test-id': {
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedRuns: [],
			},
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHTS),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE])
		assert.deepEqual(stateStore.writes, [
			{
				id: 'test-id',
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedRuns: [FIVE_NIGHT_RUN],
			},
		])
	})

	it('an alerted stretch sends no message and still writes state', async () => {
		const stateStore = memoryState({
			'test-id': {
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedRuns: [FIVE_NIGHT_RUN],
			},
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHTS),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [
			{
				id: 'test-id',
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedRuns: [FIVE_NIGHT_RUN],
			},
		])
	})

	it('a message holds only the new stretch, and state keeps both', async () => {
		const laterRun = { start: '2026-07-07', end: '2026-07-09', nights: 3 }
		const stateStore = memoryState({
			'test-id': {
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedRuns: [FIVE_NIGHT_RUN],
			},
		})
		await run({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-12' },
			scrape: fakeScrape([
				...FIVE_NIGHTS,
				'2026-07-07',
				'2026-07-08',
				'2026-07-09',
			]),
			stateStore,
		})
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /2026-07-07 → 2026-07-09> 3 nights$/)
		assert.doesNotMatch(slackMessages[0], /2026-07-01 → 2026-07-05/)
		assert.deepEqual(stateStore.writes[0].alertedRuns, [
			FIVE_NIGHT_RUN,
			laterRun,
		])
	})

	it('no stretch sends no message and writes no state', async () => {
		const stateStore = memoryState()
		const result = await run({
			scrape: fakeScrape(['2026-07-01', '2026-07-02']),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [])
	})

	it('a dry run skips Slack and state', async () => {
		const stateStore = memoryState()
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHTS),
			stateStore,
			isDryRun: true,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [])
	})

	it('a dry run writes no state for an alerted stretch', async () => {
		const stateStore = memoryState({
			'test-id': {
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedRuns: [FIVE_NIGHT_RUN],
			},
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHTS),
			stateStore,
			isDryRun: true,
		})
		assert.equal(result, 'green')
		assert.deepEqual(stateStore.writes, [])
	})
})

describe('errors', () => {
	const failingScrape = async () => {
		throw new Error('boom')
	}

	it('a thrown error sends the error message and returns red', async () => {
		const stateStore = memoryState()
		const result = await run({ scrape: failingScrape, stateStore })
		assert.equal(result, 'red')
		assert.deepEqual(slackMessages, ['🚧 *Test Property*\ntest-id\n```boom```'])
		assert.deepEqual(stateStore.writes, [])
	})

	it('a dry run with a thrown error sends no message and returns red', async () => {
		const result = await run({ scrape: failingScrape, isDryRun: true })
		assert.equal(result, 'red')
		assert.deepEqual(slackMessages, [])
	})

	it('a Slack failure on the stretch message counts as an error', async () => {
		slackStatus = 500
		const stateStore = memoryState()
		const result = await run({ scrape: fakeScrape(FIVE_NIGHTS), stateStore })
		assert.equal(result, 'red')
		assert.equal(slackMessages.length, 2)
		assert.match(slackMessages[0], /Found availability:/)
		assert.equal(
			slackMessages[1],
			'🚧 *Test Property*\ntest-id\n```Slack webhook failed: 500 nope```',
		)
		assert.deepEqual(stateStore.writes, [])
	})
})

describe('local runs', () => {
	it('with no state store, two checks send the stretch message twice', async () => {
		const scrape = fakeScrape(FIVE_NIGHTS)
		assert.equal(await run({ scrape, stateStore: null }), 'green')
		assert.equal(await run({ scrape, stateStore: null }), 'green')
		assert.equal(slackMessages.length, 2)
	})

	it('with no webhook URL, prints the message and posts nothing', async (t) => {
		const log = t.mock.method(console, 'log', () => {})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHTS),
			webhookUrl: '',
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		const printed = log.mock.calls.map((call) => call.arguments[0])
		assert.ok(printed.includes(STRETCH_MESSAGE))
	})
})
