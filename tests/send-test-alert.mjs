/**
 * Sends one sample of each Slack message, to see how it looks in Slack.
 *
 * The four samples are new stretches, a missing property, too many unknown
 * dates and an error. The missing and unknown samples link to made-up pages,
 * because only how the links look matters.
 *
 * `pnpm test.alert` runs it with `SLACK_WEBHOOK_URL` from `.env`. Point that
 * webhook at the test channel, because the samples look like real messages.
 * Without a webhook URL, the script prints each sample instead.
 *
 * Each send logs whether Slack accepted it. A send that Slack rejects stops
 * the script, so the samples after it don't go out.
 *
 * Usage: SLACK_WEBHOOK_URL=https://hooks.slack.com/... node tests/send-test-alert.mjs
 */
import { createLogger } from '../src/logger.mjs'
import {
	sendError,
	sendMissing,
	sendStretches,
	sendUnknown,
} from '../src/slack.mjs'

/**
 * Slack webhook from `.env`.
 *
 * Without one, the logger prints each sample instead of sending it.
 */
const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''

/**
 * Always verbose, unlike the CLIs, so it prints each sample when there's no
 * webhook URL.
 *
 * Every sample value is written in this file, so none of them is Sheet data.
 */
const logger = createLogger(true)

/** @type {import('../src/slack.mjs').SlackTarget} */
const slack = { webhookUrl, logger }

/**
 * A sample watchdog on the property the Integration Test uses.
 *
 * Its name has an umlaut and an emoji, to show how Slack renders both in a
 * title.
 *
 * @type {import('../src/watchdog.mjs').Watchdog}
 */
const watchdog = {
	id: 'test-homebound',
	name: 'Homebound, Bad Goisern am Hallstättersee 🏔️',
	property_url:
		'https://www.booking.com/hotel/at/homebound-apartments-bad-goisern-contactless-check-in.en-gb.html',
	checkin_date: '2026-07-01',
	checkout_date: '2026-07-31',
	adults: 2,
	children: 0,
	min_nights: 4,
}

logger.log('Sending test stretch message...')
await sendStretches(slack, watchdog, [
	{ start: '2026-07-10', end: '2026-07-17', nights: 7 },
	{ start: '2026-07-20', end: '2026-07-25', nights: 5 },
])

logger.log('\nSending test missing message...')
await sendMissing(
	slack,
	watchdog,
	'https://www.booking.com/city/at/test-town.html',
)

logger.log('\nSending test unknown message...')
await sendUnknown(
	slack,
	watchdog,
	{ unknown: 15, total: 212 },
	'https://github.com/test-owner/bookdog/actions/runs/1234',
)

logger.log('\nSending test error message...')
await sendError(slack, watchdog, 'page.goto: Timeout 30000ms exceeded.')
