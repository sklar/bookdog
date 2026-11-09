import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { json } from 'node:stream/consumers'
import { after, before, beforeEach, describe, it } from 'node:test'
import { runWatchdog } from '../src/watchdog.mjs'

const WATCHDOG = {
	id: 'test-id',
	name: 'Test Property',
	property_url: 'https://www.booking.com/hotel/xx/test-house.html',
	checkin_date: '2026-07-01',
	checkout_date: '2026-07-08',
	adults: 2,
	children: 1,
	min_nights: 3,
}

// Free nights Jul 1 to 5. With a minimum of 3, these check-ins are available.
const FIVE_NIGHT_CHECK_INS = ['2026-07-01', '2026-07-02', '2026-07-03']
const FIVE_NIGHT_STRETCH = { start: '2026-07-01', end: '2026-07-06', nights: 5 }
const STRETCH_MESSAGE = [
	'*Test Property*',
	'test-id',
	'',
	'Found availability:',
	'• <https://www.booking.com/hotel/xx/test-house.html?checkin=2026-07-01&checkout=2026-07-06&group_adults=2&group_children=1&no_rooms=1|2026-07-01 → 2026-07-06> 5 nights',
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
				alertedStretches: [],
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
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-10', min_nights: 4 },
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
				],
				adults: 2,
				children: 1,
				minNights: 4,
			},
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

	it('a watchdog with no guests or minimum nights asks for 1 adult, 0 children and 3 nights', async () => {
		const { adults, children, min_nights, ...watchdog } = WATCHDOG
		const scrape = fakeScrape()
		await run({ watchdog, scrape })
		const call = scrape.calls[0]
		assert.equal(call.adults, 1)
		assert.equal(call.children, 0)
		assert.equal(call.minNights, 3)
	})

	it('a window of 500 days asks for every check-in that fits', async () => {
		const scrape = fakeScrape()
		const result = await run({
			watchdog: {
				...WATCHDOG,
				checkin_date: '2027-01-01',
				checkout_date: '2028-05-15',
			},
			scrape,
		})
		assert.equal(result, 'green')
		const { dates } = scrape.calls[0]
		assert.equal(dates.length, 498)
		assert.equal(dates[0], '2027-01-01')
		assert.equal(dates.at(-1), '2028-05-12')
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
})

describe('invalid window or minimum nights', () => {
	const WINDOW_ERROR =
		'🚧 *Test Property*\ntest-id\n```The window has an impossible date, or its start is after its end.```'
	const LONG_WINDOW_ERROR =
		'🚧 *Test Property*\ntest-id\n```The window is longer than 500 days.```'
	const MIN_NIGHTS_ERROR =
		'🚧 *Test Property*\ntest-id\n```The minimum nights must be a whole number of at least 1.```'

	const cases = [
		{
			title: 'a reversed window whose dates are past',
			watchdog: { checkin_date: '2026-05-10', checkout_date: '2026-05-01' },
			message: WINDOW_ERROR,
		},
		{
			title: 'a start of 2026-02-30',
			watchdog: { checkin_date: '2026-02-30', checkout_date: '2026-07-10' },
			message: WINDOW_ERROR,
		},
		{
			title: 'an end of 2026-13-45',
			watchdog: { checkin_date: '2026-07-01', checkout_date: '2026-13-45' },
			message: WINDOW_ERROR,
		},
		{
			title: 'an end written as 20270710',
			watchdog: { checkin_date: '2027-07-01', checkout_date: '20270710' },
			message: WINDOW_ERROR,
		},
		{
			title: 'a window of 501 days',
			watchdog: { checkin_date: '2027-01-01', checkout_date: '2028-05-16' },
			message: LONG_WINDOW_ERROR,
		},
		{
			title: 'a window of 517 days whose dates are past',
			watchdog: { checkin_date: '2024-01-01', checkout_date: '2025-06-01' },
			message: LONG_WINDOW_ERROR,
		},
		{
			title: 'a minimum of -2',
			watchdog: { min_nights: -2 },
			message: MIN_NIGHTS_ERROR,
		},
		{
			title: 'a minimum of 0',
			watchdog: { min_nights: 0 },
			message: MIN_NIGHTS_ERROR,
		},
		{
			title: 'a minimum of 2.5',
			watchdog: { min_nights: 2.5 },
			message: MIN_NIGHTS_ERROR,
		},
	]

	for (const { title, watchdog, message } of cases) {
		it(`${title} asks for no dates, sends one error and returns red`, async () => {
			const scrape = fakeScrape()
			const stateStore = memoryState()
			const result = await run({
				watchdog: { ...WATCHDOG, ...watchdog },
				scrape,
				stateStore,
			})
			assert.equal(result, 'red')
			assert.deepEqual(scrape.calls, [])
			assert.deepEqual(slackMessages, [message])
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
				alertedStretches: [],
			},
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE])
		assert.deepEqual(stateStore.writes, [
			{
				id: 'test-id',
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedStretches: [FIVE_NIGHT_STRETCH],
			},
		])
	})

	it('an alerted stretch sends no message and still writes state', async () => {
		const stateStore = memoryState({
			'test-id': {
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedStretches: [FIVE_NIGHT_STRETCH],
			},
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [
			{
				id: 'test-id',
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedStretches: [FIVE_NIGHT_STRETCH],
			},
		])
	})

	it('a message holds only the new stretch, and state keeps both', async () => {
		const laterStretch = { start: '2026-07-07', end: '2026-07-10', nights: 3 }
		const stateStore = memoryState({
			'test-id': {
				rowIndex: 7,
				lastChecked: '2026-06-30T06:00:00.000Z',
				alertedStretches: [FIVE_NIGHT_STRETCH],
			},
		})
		await run({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-12' },
			scrape: fakeScrape([...FIVE_NIGHT_CHECK_INS, '2026-07-07']),
			stateStore,
		})
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /2026-07-07 → 2026-07-10> 3 nights$/)
		assert.doesNotMatch(slackMessages[0], /2026-07-01 → 2026-07-06/)
		assert.deepEqual(stateStore.writes[0].alertedStretches, [
			FIVE_NIGHT_STRETCH,
			laterStretch,
		])
	})

	it('no stretch sends no message and writes no state', async () => {
		const stateStore = memoryState()
		const result = await run({ scrape: fakeScrape(), stateStore })
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [])
	})

	it('a dry run skips Slack and state', async () => {
		const stateStore = memoryState()
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
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
				alertedStretches: [FIVE_NIGHT_STRETCH],
			},
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			stateStore,
			isDryRun: true,
		})
		assert.equal(result, 'green')
		assert.deepEqual(stateStore.writes, [])
	})
})

describe('errors', () => {
	it('a Slack failure on the stretch message counts as an error', async () => {
		slackStatus = 500
		const stateStore = memoryState()
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			stateStore,
		})
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
		const scrape = fakeScrape(FIVE_NIGHT_CHECK_INS)
		assert.equal(await run({ scrape, stateStore: null }), 'green')
		assert.equal(await run({ scrape, stateStore: null }), 'green')
		assert.equal(slackMessages.length, 2)
	})

	it('with no webhook URL, prints the message and posts nothing', async (t) => {
		const log = t.mock.method(console, 'log', () => {})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			webhookUrl: '',
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		const printed = log.mock.calls.map((call) => call.arguments[0])
		assert.ok(printed.includes(STRETCH_MESSAGE))
	})
})
