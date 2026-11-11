import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { json } from 'node:stream/consumers'
import { after, before, beforeEach, describe, it } from 'node:test'
import { dateRange } from '../src/dates.mjs'
import { runWatchdog } from '../src/watchdog.mjs'

/**
 * The watchdog most tests check.
 *
 * Its window, Jul 1 to Jul 8 with a minimum of 3, has 5 check-ins, Jul 1 to
 * Jul 5.
 */
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

/**
 * The available check-ins for free nights Jul 1 to 5. With a minimum of 3, the
 * last of them is Jul 3.
 */
const FIVE_NIGHT_CHECK_INS = ['2026-07-01', '2026-07-02', '2026-07-03']
const FIVE_NIGHT_STRETCH = { start: '2026-07-01', end: '2026-07-06', nights: 5 }

/**
 * The stretch message for `FIVE_NIGHT_STRETCH`. Its link asks for the
 * watchdog's guests, each child aged 13.
 */
const STRETCH_MESSAGE = [
	'*Test Property*',
	'test-id',
	'',
	'Found availability:',
	'• <https://www.booking.com/hotel/xx/test-house.html?checkin=2026-07-01&checkout=2026-07-06&group_adults=2&group_children=1&age=13&no_rooms=1|2026-07-01 → 2026-07-06> 5 nights',
].join('\n')

/**
 * Stands in for the scrape.
 *
 * A date in neither list is sold out, and a date in both is available. `calls`
 * on the returned function keeps what each call asked for.
 *
 * @param {string[]} [availableDates] Dates that come back available.
 * @param {string[]} [unknownDates] Dates that come back unknown.
 * @returns {import('../src/watchdog.mjs').Scrape & { calls: object[] }} The
 *   fake scrape.
 */
function fakeScrape(availableDates = [], unknownDates = []) {
	const calls = []
	const scrape = async (watchdog, dates) => {
		calls.push({
			propertyUrl: watchdog.property_url,
			dates,
			adults: watchdog.adults,
			children: watchdog.children,
			minNights: watchdog.min_nights,
		})
		const resultOf = (date) => {
			if (availableDates.includes(date)) return 'available'
			if (unknownDates.includes(date)) return 'unknown'
			return 'sold-out'
		}
		const dateResults = dates.map((date) => ({ date, result: resultOf(date) }))
		return { missing: false, dateResults }
	}
	return Object.assign(scrape, { calls })
}

// Booking sends the page of a missing property to a city page
const CITY_URL = 'https://www.booking.com/city/xx/test-town.html'

/**
 * Stands in for the scrape of a missing property, whose page went to
 * `CITY_URL`.
 *
 * @returns {import('../src/watchdog.mjs').Scrape} The fake scrape.
 */
function fakeMissingScrape() {
	return async () => ({ missing: true, finalUrl: CITY_URL })
}

const MISSING_MESSAGE = [
	'🚧 *Test Property*',
	'test-id',
	'Booking no longer has this property. It sends visitors to <https://www.booking.com/city/xx/test-town.html>.',
	'To stop this message, set enabled=FALSE in the Sheet.',
].join('\n')

/**
 * The workflow run link that `run` passes, as the CLI would on GitHub.
 */
const WORKFLOW_RUN_URL =
	'https://github.com/test-owner/bookdog/actions/runs/1234'

/**
 * The unknown message for 1 unknown date of the 5 in `WATCHDOG`. That's 20%,
 * above the limit of 10%.
 */
const UNKNOWN_MESSAGE = [
	'🚧 *Test Property*',
	'test-id',
	'1 of 5 dates are unknown. Booking may block the scraper, or the page changed.',
	'<https://github.com/test-owner/bookdog/actions/runs/1234|Workflow run>',
].join('\n')

/**
 * Stands in for a scrape of `WATCHDOG` with too many unknown dates. Jul 3 is
 * unknown and the other 4 dates are sold out, so the check sends
 * `UNKNOWN_MESSAGE`.
 *
 * @returns {import('../src/watchdog.mjs').Scrape} The fake scrape.
 */
function fakeTooManyUnknownScrape() {
	return fakeScrape([], ['2026-07-03'])
}

/**
 * A watchdog with 10 check-ins, Jul 1 to 10, so 1 unknown date is exactly 10%.
 */
const TEN_DATE_WATCHDOG = { ...WATCHDOG, checkout_date: '2026-07-13' }

/**
 * The stretch that an available Jul 8 makes in `TEN_DATE_WATCHDOG`.
 */
const JULY_8_STRETCH = { start: '2026-07-08', end: '2026-07-11', nights: 3 }

/**
 * Stands in for the state tab.
 *
 * A write replaces the watchdog's row, so the next check reads it, as on the
 * Sheet. A watchdog with no row reads empty state.
 *
 * `reads` holds each object that `read` returned. `writes` holds a copy of each
 * write, with its `id`.
 *
 * @param {Object<string, object>} [rows] State rows by watchdog ID, before the
 *   first check.
 * @returns {import('../src/watchdog.mjs').StateStore & {
 *   reads: object[], writes: object[] }} The state store.
 */
function memoryState(rows = {}) {
	const reads = []
	const writes = []
	return {
		reads,
		writes,
		read: async (id) => {
			const state = structuredClone(rows[id]) ?? {
				rowIndex: null,
				lastChecked: null,
				alertedStretches: [],
			}
			reads.push(state)
			return state
		},
		write: async (id, state) => {
			writes.push({ id, ...structuredClone(state) })
			rows[id] = structuredClone(state)
		},
	}
}

/**
 * Builds the state row of a watchdog that an earlier workflow run checked.
 *
 * @param {object[]} alertedStretches Stretches that already had their message.
 * @returns {object} The row, on Sheet row 7.
 */
function storedState(alertedStretches) {
	return {
		rowIndex: 7,
		lastChecked: '2026-06-01T06:00:00.000Z',
		alertedStretches,
	}
}

// A local stand-in for the Slack webhook. It records the text of each message
// in `slackMessages`. It answers each message with the next status in
// `slackStatuses`, then with `slackStatus` once that list is empty.
// `beforeEach` resets all three, with `slackStatus` at 200.
let slackServer
let slackUrl
let slackMessages
let slackStatus
let slackStatuses

before(async () => {
	slackServer = createServer(async (req, res) => {
		const { text } = await json(req)
		slackMessages.push(text)
		const status = slackStatuses.shift() ?? slackStatus
		res.writeHead(status)
		res.end(status === 200 ? 'ok' : 'nope')
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
	slackStatuses = []
})

/**
 * Checks `WATCHDOG` on 2026-06-15.
 *
 * Unless `overrides` says otherwise, the scrape finds every date sold out,
 * state starts empty in memory, and messages go to the local Slack with a
 * workflow run link.
 *
 * @param {object} [overrides] Options of `runWatchdog` that replace these.
 * @returns {Promise<'red' | 'green'>} The colour of the check.
 */
function run(overrides = {}) {
	return runWatchdog({
		watchdog: WATCHDOG,
		today: '2026-06-15',
		scrape: fakeScrape(),
		stateStore: memoryState(),
		webhookUrl: slackUrl,
		workflowRunUrl: WORKFLOW_RUN_URL,
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

	it('a watchdog with no guests or minimum nights asks for and links to 1 adult, 0 children and 3 nights', async () => {
		const { adults, children, min_nights, ...watchdog } = WATCHDOG
		const scrape = fakeScrape(['2026-07-01'])
		await run({ watchdog, scrape })
		const call = scrape.calls[0]
		assert.equal(call.adults, 1)
		assert.equal(call.children, 0)
		assert.equal(call.minNights, 3)
		assert.match(
			slackMessages[0],
			/checkin=2026-07-01&checkout=2026-07-04&group_adults=1&group_children=0&/,
		)
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

describe('invalid watchdog', () => {
	const URL_ERROR =
		'🚧 *Test Property*\ntest-id\n```The property URL must start with https://www.booking.com/hotel/.```'
	const WINDOW_ERROR =
		'🚧 *Test Property*\ntest-id\n```The window has an impossible date, or its start is after its end.```'
	const LONG_WINDOW_ERROR =
		'🚧 *Test Property*\ntest-id\n```The window is longer than 500 days.```'
	const MIN_NIGHTS_ERROR =
		'🚧 *Test Property*\ntest-id\n```The minimum nights must be a whole number of at least 1.```'
	// Only a watchdog passed in directly can have these. `config.mjs` gives a bad
	// Sheet cell its default.
	const ADULTS_ERROR =
		'🚧 *Test Property*\ntest-id\n```The number of adults must be a whole number of at least 1.```'
	const CHILDREN_ERROR =
		'🚧 *Test Property*\ntest-id\n```The number of children must be a whole number of at least 0.```'

	const cases = [
		{
			title: 'a URL on another site',
			watchdog: {
				property_url: 'https://example.com/hotel/xx/test-house.html',
			},
			message: URL_ERROR,
		},
		{
			title: 'a host that only starts like Booking',
			watchdog: {
				property_url:
					'https://www.booking.com.example.com/hotel/xx/test-house.html',
			},
			message: URL_ERROR,
		},
		{
			title: 'a URL without https',
			watchdog: {
				property_url: 'http://www.booking.com/hotel/xx/test-house.html',
			},
			message: URL_ERROR,
		},
		{
			title: 'a city page',
			watchdog: {
				property_url: 'https://www.booking.com/city/xx/test-town.html',
			},
			message: URL_ERROR,
		},
		{
			title: 'text that is no URL',
			watchdog: { property_url: 'test house' },
			message: URL_ERROR,
		},
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
			title: 'a minimum of 0',
			watchdog: { min_nights: 0 },
			message: MIN_NIGHTS_ERROR,
		},
		{
			title: 'a minimum of 2.5',
			watchdog: { min_nights: 2.5 },
			message: MIN_NIGHTS_ERROR,
		},
		{ title: '0 adults', watchdog: { adults: 0 }, message: ADULTS_ERROR },
		{ title: '2.5 adults', watchdog: { adults: 2.5 }, message: ADULTS_ERROR },
		{
			title: 'adults of null',
			watchdog: { adults: null },
			message: ADULTS_ERROR,
		},
		{
			title: '-1 children',
			watchdog: { children: -1 },
			message: CHILDREN_ERROR,
		},
		{
			title: '1.5 children',
			watchdog: { children: 1.5 },
			message: CHILDREN_ERROR,
		},
		{
			title: 'children of null',
			watchdog: { children: null },
			message: CHILDREN_ERROR,
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

	it('a Booking URL in capitals is fine', async () => {
		const result = await run({
			watchdog: {
				...WATCHDOG,
				property_url: 'HTTPS://WWW.BOOKING.COM/hotel/xx/test-house.html',
			},
		})
		assert.equal(result, 'green')
	})
})

describe('stretches', () => {
	it('a new stretch sends one message and writes a new state', async () => {
		const stateStore = memoryState({ 'test-id': storedState([]) })
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE])
		assert.deepEqual(stateStore.reads, [storedState([])])
		assert.deepEqual(stateStore.writes, [
			{ id: 'test-id', ...storedState([FIVE_NIGHT_STRETCH]) },
		])
	})

	it('an alerted stretch sends no message and still writes state', async () => {
		const stateStore = memoryState({
			'test-id': storedState([FIVE_NIGHT_STRETCH]),
		})
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.deepEqual(stateStore.writes, [
			{ id: 'test-id', ...storedState([FIVE_NIGHT_STRETCH]) },
		])
	})

	it('a message holds only the new stretch, and state keeps both', async () => {
		const laterStretch = { start: '2026-07-07', end: '2026-07-10', nights: 3 }
		const stateStore = memoryState({
			'test-id': storedState([FIVE_NIGHT_STRETCH]),
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

	it('a stretch that goes away and comes back sends a second message', async () => {
		const stateStore = memoryState({ 'test-id': storedState([]) })
		const days = [
			{ today: '2026-06-15', available: FIVE_NIGHT_CHECK_INS },
			{ today: '2026-06-16', available: [] },
			{ today: '2026-06-17', available: FIVE_NIGHT_CHECK_INS },
		]
		for (const { today, available } of days) {
			const result = await run({
				today,
				scrape: fakeScrape(available),
				stateStore,
			})
			assert.equal(result, 'green')
		}
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE, STRETCH_MESSAGE])
		assert.deepEqual(
			stateStore.writes.map((write) => write.alertedStretches),
			[[FIVE_NIGHT_STRETCH], [], [FIVE_NIGHT_STRETCH]],
		)
	})

	it('a stretch that includes today sends one message as today moves', async () => {
		const stateStore = memoryState()
		for (const today of ['2026-07-02', '2026-07-03', '2026-07-04']) {
			const result = await run({
				watchdog: { ...WATCHDOG, checkout_date: '2026-07-20' },
				today,
				scrape: fakeScrape(dateRange('2026-07-01', '2026-07-20')),
				stateStore,
			})
			assert.equal(result, 'green')
		}
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /2026-07-02 → 2026-07-20> 18 nights$/)
	})

	it('links without the query of a pasted URL, whose guests would win on Booking', async () => {
		const pastedUrl = `${WATCHDOG.property_url}?room1=A%2CA%2CA%2CA&req_adults=4`
		await run({
			watchdog: { ...WATCHDOG, property_url: pastedUrl },
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
		})
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE])
	})
})

describe('date results', () => {
	it('an unknown date ends a stretch, and the log counts each result', async (t) => {
		const log = t.mock.method(console, 'log', () => {})
		// Jul 1 and 3 available, Jul 2 unknown, Jul 4 to 10 sold out
		await run({
			watchdog: TEN_DATE_WATCHDOG,
			scrape: fakeScrape(['2026-07-01', '2026-07-03'], ['2026-07-02']),
		})
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /2026-07-01 → 2026-07-04> 3 nights\n/)
		assert.match(slackMessages[0], /2026-07-03 → 2026-07-06> 3 nights$/)
		const printed = log.mock.calls.map((call) => call.arguments[0])
		assert.ok(
			printed.includes(
				'   Dates checked: 10 — 2 available, 7 sold out, 1 unknown',
			),
			printed.join('\n'),
		)
	})
})

describe('too many unknown dates', () => {
	it("without a workflow run, as on the owner's machine, the unknown message has no link line", async () => {
		await run({
			scrape: fakeTooManyUnknownScrape(),
			workflowRunUrl: null,
		})
		const withoutLink = UNKNOWN_MESSAGE.split('\n').slice(0, -1).join('\n')
		assert.deepEqual(slackMessages, [withoutLink])
	})

	it('more than 10% unknown returns red and sends the unknown message, after the message for a found stretch', async () => {
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS, ['2026-07-04']),
		})
		assert.equal(result, 'red')
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE, UNKNOWN_MESSAGE])
	})

	it('keeps the alerted stretches and adds the new ones, so the next day repeats no message', async () => {
		const stateStore = memoryState({
			'test-id': storedState([FIVE_NIGHT_STRETCH]),
		})
		// On day 1, Jul 1 to 3 are unknown and hide the alerted stretch, and Jul 8
		// is new. On day 2, every date has its answer again, and both stretches
		// already had their message.
		const days = [
			{
				today: '2026-06-15',
				scrape: fakeScrape(['2026-07-08'], FIVE_NIGHT_CHECK_INS),
			},
			{
				today: '2026-06-16',
				scrape: fakeScrape([...FIVE_NIGHT_CHECK_INS, '2026-07-08']),
			},
		]
		const results = []
		for (const { today, scrape } of days) {
			results.push(
				await run({
					watchdog: TEN_DATE_WATCHDOG,
					today,
					scrape,
					stateStore,
				}),
			)
		}
		assert.deepEqual(results, ['red', 'green'])
		assert.equal(slackMessages.length, 2)
		assert.match(slackMessages[0], /2026-07-08 → 2026-07-11> 3 nights$/)
		assert.match(slackMessages[1], /3 of 10 dates are unknown/)
		assert.deepEqual(
			stateStore.writes.map((write) => write.alertedStretches),
			[
				[FIVE_NIGHT_STRETCH, JULY_8_STRETCH],
				[FIVE_NIGHT_STRETCH, JULY_8_STRETCH],
			],
		)
	})

	it('exactly 10% unknown sends no unknown message, returns green and replaces the alerted stretches', async () => {
		const stateStore = memoryState({
			'test-id': storedState([FIVE_NIGHT_STRETCH]),
		})
		// Jul 1 unknown, Jul 8 available
		const result = await run({
			watchdog: TEN_DATE_WATCHDOG,
			scrape: fakeScrape(['2026-07-08'], ['2026-07-01']),
			stateStore,
		})
		assert.equal(result, 'green')
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /Found availability:/)
		assert.deepEqual(stateStore.writes[0].alertedStretches, [JULY_8_STRETCH])
	})
})

describe('missing property', () => {
	it('sends the missing message each day, writes no state and returns red until Booking lists the property again', async () => {
		const stateStore = memoryState()
		const days = [
			{ today: '2026-06-15', scrape: fakeMissingScrape() },
			{ today: '2026-06-16', scrape: fakeMissingScrape() },
			{ today: '2026-06-17', scrape: fakeScrape() },
		]
		const results = []
		for (const { today, scrape } of days) {
			results.push(await run({ today, scrape, stateStore }))
		}
		assert.deepEqual(results, ['red', 'red', 'green'])
		assert.deepEqual(slackMessages, [MISSING_MESSAGE, MISSING_MESSAGE])
		assert.equal(stateStore.writes.length, 1)
	})
})

describe('dry run', () => {
	// Without the dry run, each case sends a Slack message, and the new stretch
	// also writes state
	const cases = [
		{
			title: 'a reversed window',
			overrides: {
				watchdog: {
					...WATCHDOG,
					checkin_date: '2026-05-10',
					checkout_date: '2026-05-01',
				},
			},
			result: 'red',
		},
		{
			title: 'a new stretch',
			overrides: { scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) },
			result: 'green',
		},
		{
			title: 'a missing property',
			overrides: { scrape: fakeMissingScrape() },
			result: 'red',
		},
		{
			title: 'too many unknown dates',
			overrides: { scrape: fakeTooManyUnknownScrape() },
			result: 'red',
		},
	]

	for (const { title, overrides, result } of cases) {
		it(`with ${title} sends nothing, writes no state and returns ${result}`, async () => {
			const stateStore = memoryState()
			assert.equal(
				await run({ ...overrides, stateStore, isDryRun: true }),
				result,
			)
			assert.deepEqual(slackMessages, [])
			assert.deepEqual(stateStore.writes, [])
		})
	}
})

describe('errors', () => {
	const SLACK_ERROR_MESSAGE =
		'🚧 *Test Property*\ntest-id\n```Slack webhook failed: 500 nope```'

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
		assert.equal(slackMessages[1], SLACK_ERROR_MESSAGE)
		assert.deepEqual(stateStore.writes, [])
	})

	it('a Slack failure on the missing message counts as an error', async () => {
		slackStatus = 500
		const result = await run({ scrape: fakeMissingScrape() })
		assert.equal(result, 'red')
		assert.deepEqual(slackMessages, [MISSING_MESSAGE, SLACK_ERROR_MESSAGE])
	})

	it('a Slack failure on the unknown message is an error, writes no state, and the stretch message comes again the next day', async () => {
		// Slack takes the stretch message, refuses the unknown message and takes
		// every message after that
		slackStatuses = [200, 500]
		const stateStore = memoryState()
		const days = [
			{
				today: '2026-06-15',
				scrape: fakeScrape(FIVE_NIGHT_CHECK_INS, ['2026-07-04']),
			},
			{ today: '2026-06-16', scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) },
		]
		const results = []
		for (const { today, scrape } of days) {
			results.push(await run({ today, scrape, stateStore }))
		}
		assert.deepEqual(results, ['red', 'green'])
		assert.deepEqual(slackMessages, [
			STRETCH_MESSAGE,
			UNKNOWN_MESSAGE,
			SLACK_ERROR_MESSAGE,
			STRETCH_MESSAGE,
		])
		assert.deepEqual(
			stateStore.writes.map((write) => write.alertedStretches),
			[[FIVE_NIGHT_STRETCH]],
		)
	})

	it('an unreachable Slack returns red', async () => {
		const result = await run({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			webhookUrl: 'http://127.0.0.1:1',
		})
		assert.equal(result, 'red')
	})
})

describe('watchdog with no name', () => {
	const { name, ...unnamed } = WATCHDOG
	const watchdog = {
		...unnamed,
		property_url:
			'https://www.booking.com/hotel/xx/test-house.en-gb.html?aid=123',
	}

	it('every message takes its title from the URL, without the language code or query', async () => {
		// Slack refuses the stretch message, so an error message follows it
		slackStatus = 500
		await run({ watchdog, scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) })
		slackStatus = 200
		await run({ watchdog, scrape: fakeMissingScrape() })
		await run({ watchdog, scrape: fakeTooManyUnknownScrape() })
		const titles = slackMessages.map((message) => message.split('\n')[0])
		assert.deepEqual(titles, [
			'*Test House*',
			'🚧 *Test House*',
			'🚧 *Test House*',
			'🚧 *Test House*',
		])
		assert.match(slackMessages[0], /Found availability:/)
		assert.match(slackMessages[1], /Slack webhook failed/)
		assert.match(slackMessages[2], /Booking no longer has this property/)
		assert.match(slackMessages[3], /1 of 5 dates are unknown/)
	})
})

describe("a check on the owner's machine", () => {
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
