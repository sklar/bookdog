import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { json } from 'node:stream/consumers'
import { after, before, beforeEach, describe, it } from 'node:test'
import { dateRange } from '../src/dates.mjs'
import { createLogger } from '../src/logger.mjs'
import { runWatchdog } from '../src/watchdog.mjs'
import { captureConsole } from './helpers.mjs'

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
 * The available check-ins for free nights Jul 1 to 5.
 *
 * With a minimum of 3, the last of them is Jul 3.
 */
const FIVE_NIGHT_CHECK_INS = ['2026-07-01', '2026-07-02', '2026-07-03']

/**
 * The stretch that `FIVE_NIGHT_CHECK_INS` make, 5 nights from Jul 1.
 */
const FIVE_NIGHT_STRETCH = { start: '2026-07-01', end: '2026-07-06', nights: 5 }

/**
 * The stretch message for `FIVE_NIGHT_STRETCH`.
 *
 * Its link asks for the watchdog's guests, each child aged 13.
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
 * It ignores the logger and prints nothing, unlike the real scrape. So a test
 * that pins the whole log sees only the lines of `runWatchdog`.
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

/**
 * The city page where Booking sends the page of a missing property.
 */
const CITY_URL = 'https://www.booking.com/city/xx/test-town.html'

/**
 * Stands in for the scrape of a missing property.
 *
 * @param {string} [finalUrl] Where the property's page went.
 * @returns {import('../src/watchdog.mjs').Scrape} The fake scrape.
 */
function fakeMissingScrape(finalUrl = CITY_URL) {
	return async () => ({ missing: true, finalUrl })
}

/**
 * The first two lines of the missing, unknown and error messages for
 * `WATCHDOG`.
 */
const PROBLEM_HEADER = ['🚧 *Test Property*', 'test-id']

/**
 * The missing message for `WATCHDOG`, with a link to `CITY_URL`.
 */
const MISSING_MESSAGE = [
	...PROBLEM_HEADER,
	'Booking no longer has this property. It sends visitors to <https://www.booking.com/city/xx/test-town.html>.',
	'To stop this message, set enabled=FALSE in the Sheet.',
].join('\n')

/**
 * The workflow run link that `check` passes, as the CLI would on GitHub.
 */
const WORKFLOW_RUN_URL =
	'https://github.com/test-owner/bookdog/actions/runs/1234'

/**
 * The message about too many unknown dates, for 1 unknown date of the 5 in
 * `WATCHDOG`.
 *
 * That's 20%, above the limit of 10%.
 */
const UNKNOWN_MESSAGE = [
	...PROBLEM_HEADER,
	'1 of 5 dates are unknown. Booking may block the scraper, or the page changed.',
	'<https://github.com/test-owner/bookdog/actions/runs/1234|Workflow run>',
].join('\n')

/**
 * Builds the error message for `WATCHDOG`.
 *
 * @param {string} text The error, as `describeError` gives it.
 * @returns {string} The message, with `text` in a code block.
 */
function errorMessage(text) {
	return [...PROBLEM_HEADER, `\`\`\`${text}\`\`\``].join('\n')
}

/**
 * Stands in for a scrape of `WATCHDOG` with too many unknown dates.
 *
 * Jul 3 is unknown and the other 4 dates are sold out, so the check sends
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

/**
 * A local stand-in for the Slack webhook, one for the whole file.
 */
let slackServer

/**
 * Where the stand-in listens. `check` passes it as the webhook URL.
 */
let slackUrl

/**
 * The text of each message the stand-in got in this test, in order.
 */
let slackMessages

/**
 * What the stand-in answers once `slackStatuses` is empty. 200 unless the test
 * sets it.
 */
let slackStatus

/**
 * What the stand-in answers to the next messages, one status each. Empty
 * unless the test fills it.
 */
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
 * state starts empty in memory, messages go to the local Slack with a workflow
 * run link, and the log isn't verbose, as on GitHub.
 *
 * @param {object} [overrides] Options of `runWatchdog` that replace these.
 * @returns {Promise<'red' | 'green'>} The colour of the check.
 */
function check(overrides = {}) {
	return runWatchdog({
		watchdog: WATCHDOG,
		today: '2026-06-15',
		scrape: fakeScrape(),
		stateStore: memoryState(),
		webhookUrl: slackUrl,
		workflowRunUrl: WORKFLOW_RUN_URL,
		isDryRun: false,
		logger: createLogger(false),
		...overrides,
	})
}

/**
 * Checks once on each day, in order, as the daily workflow runs would.
 *
 * @param {{ today: string, scrape?: import('../src/watchdog.mjs').Scrape }[]}
 *   days Each day's date, and its scrape when it differs from `overrides`.
 * @param {object} [overrides] Options of `runWatchdog` for every day, such as
 *   one `stateStore` that the days share.
 * @returns {Promise<('red' | 'green')[]>} The colour of each day's check.
 */
async function checkDays(days, overrides = {}) {
	const results = []
	for (const day of days) {
		results.push(await check({ ...overrides, ...day }))
	}
	return results
}

describe('dates asked for', () => {
	it('asks from the window start to the last check-in that fits when today is before the window', async () => {
		const scrape = fakeScrape()
		await check({
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
		await check({
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-10' },
			today: '2026-07-07',
			scrape,
		})
		assert.deepEqual(scrape.calls[0].dates, ['2026-07-07'])
	})

	it('a watchdog with no guests or minimum nights asks for and links to 1 adult, 0 children and 3 nights', async () => {
		const { adults, children, min_nights, ...watchdog } = WATCHDOG
		const scrape = fakeScrape(['2026-07-01'])
		await check({ watchdog, scrape })
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
		const result = await check({
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
			const result = await check({
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
	const URL_ERROR = errorMessage(
		'The property URL must start with https://www.booking.com/hotel/.',
	)
	const WINDOW_ERROR = errorMessage(
		'The window has an impossible date, or its start is after its end.',
	)
	const LONG_WINDOW_ERROR = errorMessage('The window is longer than 500 days.')
	// Only a watchdog from `WATCHDOG_CONFIG` or a test can get the three errors
	// below. `config.mjs` gives a bad Sheet cell its default.
	const MIN_NIGHTS_ERROR = errorMessage(
		'The minimum nights must be a whole number of at least 1.',
	)
	const ADULTS_ERROR = errorMessage(
		'The number of adults must be a whole number of at least 1.',
	)
	const CHILDREN_ERROR = errorMessage(
		'The number of children must be a whole number of at least 0.',
	)

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
			const result = await check({
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
		const result = await check({
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
		const result = await check({
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
		const result = await check({
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
		await check({
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
			{ today: '2026-06-15', scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) },
			{ today: '2026-06-16', scrape: fakeScrape() },
			{ today: '2026-06-17', scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) },
		]
		const results = await checkDays(days, { stateStore })
		assert.deepEqual(results, ['green', 'green', 'green'])
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE, STRETCH_MESSAGE])
		assert.deepEqual(
			stateStore.writes.map((write) => write.alertedStretches),
			[[FIVE_NIGHT_STRETCH], [], [FIVE_NIGHT_STRETCH]],
		)
	})

	it('a stretch that includes today sends one message as today moves', async () => {
		const days = ['2026-07-02', '2026-07-03', '2026-07-04'].map((today) => ({
			today,
		}))
		const results = await checkDays(days, {
			watchdog: { ...WATCHDOG, checkout_date: '2026-07-20' },
			scrape: fakeScrape(dateRange('2026-07-01', '2026-07-20')),
			stateStore: memoryState(),
		})
		assert.deepEqual(results, ['green', 'green', 'green'])
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /2026-07-02 → 2026-07-20> 18 nights$/)
	})

	it('links without the query of a pasted URL, whose guests would win on Booking', async () => {
		const pastedUrl = `${WATCHDOG.property_url}?room1=A%2CA%2CA%2CA&req_adults=4`
		await check({
			watchdog: { ...WATCHDOG, property_url: pastedUrl },
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
		})
		assert.deepEqual(slackMessages, [STRETCH_MESSAGE])
	})
})

describe('date results', () => {
	it('an unknown date ends a stretch, and the log counts each result', async (t) => {
		const printed = captureConsole(t)
		// Jul 1 and 3 available, Jul 2 unknown, Jul 4 to 10 sold out
		await check({
			watchdog: TEN_DATE_WATCHDOG,
			scrape: fakeScrape(['2026-07-01', '2026-07-03'], ['2026-07-02']),
		})
		assert.equal(slackMessages.length, 1)
		assert.match(slackMessages[0], /2026-07-01 → 2026-07-04> 3 nights\n/)
		assert.match(slackMessages[0], /2026-07-03 → 2026-07-06> 3 nights$/)
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
		await check({
			scrape: fakeTooManyUnknownScrape(),
			workflowRunUrl: null,
		})
		const withoutLink = UNKNOWN_MESSAGE.split('\n').slice(0, -1).join('\n')
		assert.deepEqual(slackMessages, [withoutLink])
	})

	it('more than 10% unknown returns red and sends the unknown message, after the message for a found stretch', async () => {
		const result = await check({
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
		const results = await checkDays(days, {
			watchdog: TEN_DATE_WATCHDOG,
			stateStore,
		})
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
		const result = await check({
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
		const results = await checkDays(days, { stateStore })
		assert.deepEqual(results, ['red', 'red', 'green'])
		assert.deepEqual(slackMessages, [MISSING_MESSAGE, MISSING_MESSAGE])
		assert.equal(stateStore.writes.length, 1)
	})
})

describe('dry run', () => {
	/**
	 * `WATCHDOG` with a window that starts after it ends.
	 *
	 * `validateWatchdog` throws on it, so the check ends in the error message.
	 */
	const REVERSED_WINDOW = {
		...WATCHDOG,
		checkin_date: '2026-05-10',
		checkout_date: '2026-05-01',
	}

	/**
	 * One check for each Slack message.
	 *
	 * Without the dry run, each check sends its message, and the new stretch
	 * also writes state.
	 */
	const cases = [
		{
			title: 'a reversed window',
			overrides: { watchdog: REVERSED_WINDOW },
			message: 'error',
			result: 'red',
		},
		{
			title: 'a new stretch',
			overrides: { scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) },
			message: 'stretch',
			result: 'green',
		},
		{
			title: 'a missing property',
			overrides: { scrape: fakeMissingScrape() },
			message: 'missing',
			result: 'red',
		},
		{
			title: 'too many unknown dates',
			overrides: { scrape: fakeTooManyUnknownScrape() },
			message: 'unknown',
			result: 'red',
		},
	]

	for (const { title, overrides, message, result } of cases) {
		it(`with ${title} sends nothing, writes no state, logs the ${message} message it skips last and returns ${result}`, async (t) => {
			const printed = captureConsole(t)
			const stateStore = memoryState()
			assert.equal(
				await check({ ...overrides, stateStore, isDryRun: true }),
				result,
			)
			assert.deepEqual(slackMessages, [])
			assert.deepEqual(stateStore.writes, [])
			assert.equal(
				printed.at(-1),
				`[DRY RUN] Would send the ${message} message.`,
				printed.join('\n'),
			)
		})
	}
})

describe('errors', () => {
	/**
	 * The error message after the local Slack answers a message with 500.
	 */
	const SLACK_ERROR_MESSAGE = errorMessage('Slack webhook failed: 500 nope')

	it('a Slack failure on the stretch message counts as an error', async () => {
		slackStatus = 500
		const stateStore = memoryState()
		const result = await check({
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
		const result = await check({ scrape: fakeMissingScrape() })
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
		const results = await checkDays(days, { stateStore })
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
		// Fetch refuses port 1 before it connects, which fails the send just the
		// same
		const result = await check({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			webhookUrl: 'http://127.0.0.1:1',
		})
		assert.equal(result, 'red')
	})

	/**
	 * The message of the error the Sheets client throws when it can't reach
	 * Google, shortened.
	 *
	 * The message ends in the reason. The error's cause has the same message,
	 * so `describeError` shows it once.
	 */
	const SHEETS_MESSAGE =
		'request to https://sheets.googleapis.com/v4/spreadsheets failed, reason: connect ECONNREFUSED'

	/**
	 * Values that a check can catch, and the text of each in the error message.
	 *
	 * The fake scrape throws each one. The Sheets client really runs in the
	 * state store, but the error message doesn't depend on where the value came
	 * from.
	 */
	const caughtValues = [
		{
			title: 'the error message adds the cause of a fetch error',
			err: new TypeError('fetch failed', {
				cause: new Error('connect ECONNREFUSED 127.0.0.1:443'),
			}),
			text: 'fetch failed (connect ECONNREFUSED 127.0.0.1:443)',
		},
		{
			title: 'the error message shows the cause of a Sheets client error once',
			err: new Error(SHEETS_MESSAGE, { cause: new Error(SHEETS_MESSAGE) }),
			text: SHEETS_MESSAGE,
		},
		{
			title: 'the error message shows a thrown string as it is',
			err: 'boom',
			text: 'boom',
		},
	]

	for (const { title, err, text } of caughtValues) {
		it(title, async () => {
			const scrape = async () => {
				throw err
			}
			assert.equal(await check({ scrape }), 'red')
			assert.deepEqual(slackMessages, [errorMessage(text)])
		})
	}
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
		await check({ watchdog, scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) })
		slackStatus = 200
		await check({ watchdog, scrape: fakeMissingScrape() })
		await check({ watchdog, scrape: fakeTooManyUnknownScrape() })
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
		assert.equal(await check({ scrape, stateStore: null }), 'green')
		assert.equal(await check({ scrape, stateStore: null }), 'green')
		assert.equal(slackMessages.length, 2)
	})

	it('with no webhook URL, prints the message, posts nothing and says so', async (t) => {
		const printed = captureConsole(t)
		const result = await check({
			scrape: fakeScrape(FIVE_NIGHT_CHECK_INS),
			webhookUrl: '',
			logger: createLogger(true),
		})
		assert.equal(result, 'green')
		assert.deepEqual(slackMessages, [])
		assert.ok(printed.includes(STRETCH_MESSAGE), printed.join('\n'))
		assert.ok(
			printed.includes('   No Slack webhook URL, so the message was not sent.'),
			printed.join('\n'),
		)
		assert.ok(!printed.includes('   Slack message sent.'), printed.join('\n'))
	})
})

describe('public log', () => {
	/**
	 * `WATCHDOG` with an id, name and URL that are easy to find in a log.
	 */
	const PRIVATE_WATCHDOG = {
		...WATCHDOG,
		id: 'hidden-id',
		name: 'Hidden Name',
		property_url: 'https://www.booking.com/hotel/xx/hidden-house.html',
	}

	/**
	 * Where the page of `PRIVATE_WATCHDOG` goes when the property is missing.
	 */
	const HIDDEN_CITY_URL = 'https://www.booking.com/city/xx/hidden-town.html'

	/**
	 * An error as Playwright throws it, with the page's URL in its message.
	 */
	const SCRAPE_ERROR = new Error(
		'page.goto: Timeout 30000ms exceeded.\n  - navigating to "https://www.booking.com/hotel/xx/hidden-house.html?checkin=2026-07-01"',
	)

	/**
	 * A webhook URL on a port that was free a moment ago, so nothing listens.
	 *
	 * Fetch fails there with `fetch failed`, and the error's cause says why.
	 * Port 1 won't do here, because fetch refuses it as a bad port, and the
	 * cause then says only that.
	 */
	let unreachableUrl

	before(async () => {
		const server = createServer()
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
		unreachableUrl = `http://127.0.0.1:${server.address().port}`
		await new Promise((resolve) => server.close(resolve))
	})

	/**
	 * Values that a public log must not show.
	 *
	 * They are the watchdog's name, URL, id and dates, the final URL and the
	 * error message. The dates are the window's start and end and the end of
	 * `FIVE_NIGHT_STRETCH`.
	 */
	const PRIVATE_VALUES = [
		'hidden-id',
		'Hidden Name',
		'hidden-house',
		'hidden-town',
		'2026-07-01',
		'2026-07-06',
		'2026-07-08',
		'Timeout 30000ms exceeded',
	]

	/**
	 * Checks `PRIVATE_WATCHDOG` once for each line that shows more when the
	 * log is verbose.
	 *
	 * The seven checks send a stretch message, find a stretch with no webhook
	 * URL, find one on a dry run, find the property missing, find too many
	 * unknown dates, catch a scrape error and fail to reach Slack. The last
	 * one catches an error with a cause.
	 *
	 * @param {import('node:test').TestContext} t
	 * @param {boolean} verbose `true` as on the owner's machine.
	 * @returns {Promise<string>} Everything the checks printed.
	 */
	async function logOfChecks(t, verbose) {
		const lines = captureConsole(t)
		const throwingScrape = async () => {
			throw SCRAPE_ERROR
		}
		const checks = [
			{ scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) },
			{ scrape: fakeScrape(FIVE_NIGHT_CHECK_INS), webhookUrl: '' },
			{ scrape: fakeScrape(FIVE_NIGHT_CHECK_INS), isDryRun: true },
			{ scrape: fakeMissingScrape(HIDDEN_CITY_URL) },
			{ scrape: fakeTooManyUnknownScrape() },
			{ scrape: throwingScrape },
			{ scrape: fakeScrape(FIVE_NIGHT_CHECK_INS), webhookUrl: unreachableUrl },
		]
		for (const overrides of checks) {
			await check({
				watchdog: PRIVATE_WATCHDOG,
				logger: createLogger(verbose),
				...overrides,
			})
		}
		return lines.join('\n')
	}

	it('a check with no stretches logs the counts, one line about stretches and the state write', async (t) => {
		const printed = captureConsole(t)
		await check()
		assert.deepEqual(printed, [
			'   Dates checked: 5 — 0 available, 5 sold out, 0 unknown',
			'   Stretches found: 0',
			'   State updated.',
		])
	})

	it('a new stretch logs that Slack accepted the message', async (t) => {
		const printed = captureConsole(t)
		await check({ scrape: fakeScrape(FIVE_NIGHT_CHECK_INS) })
		assert.deepEqual(printed, [
			'   Dates checked: 5 — 3 available, 2 sold out, 0 unknown',
			'   Stretches found: 1',
			'   Slack message sent.',
			'   State updated.',
		])
	})

	it('with verbose off, as on GitHub, shows no name, URL, id, date or error message', async (t) => {
		const log = await logOfChecks(t, false)
		for (const value of PRIVATE_VALUES) {
			assert.ok(!log.includes(value), `The log shows ${value}:\n${log}`)
		}
		// The thrown error still gets its line, with only its name
		assert.match(log, /^Check failed: Error$/m)
	})

	it("with verbose on, as on the owner's machine, shows each of them", async (t) => {
		const log = await logOfChecks(t, true)
		for (const value of PRIVATE_VALUES) {
			assert.ok(log.includes(value), `The log lacks ${value}:\n${log}`)
		}
		// The error's cause says why fetch failed
		assert.match(
			log,
			/^Check failed: fetch failed \(connect ECONNREFUSED 127\.0\.0\.1:\d+\)$/m,
		)
	})
})
