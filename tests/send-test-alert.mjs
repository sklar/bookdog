/**
 * Sends one sample of each Slack message, to check how it looks in Slack. The
 * four samples are new stretches, a missing property, too many unknown dates
 * and an error.
 *
 * `pnpm test.alert` runs it with the values in `.env`. Point
 * `SLACK_WEBHOOK_URL` there at the test channel, because the samples look like
 * real messages. Without a webhook URL, the script prints them instead.
 *
 * The missing and unknown samples link to made-up pages, so those links don't
 * open anything real. Only how they look matters.
 *
 * Usage: SLACK_WEBHOOK_URL=https://hooks.slack.com/... node tests/send-test-alert.mjs
 */
import {
	sendError,
	sendMissing,
	sendStretches,
	sendUnknown,
} from '../src/slack.mjs'

/**
 * Slack webhook from `.env`. Empty prints the samples instead.
 */
const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''

/**
 * A sample watchdog on the property the Integration Test uses.
 *
 * Its name has an umlaut and an emoji, so the samples show how Slack renders
 * both in a title.
 *
 * @type {import('../src/watchdog.mjs').Watchdog}
 */
const watchdog = {
	id: 'hexenhauschen-20260701-20260731-4N2A0C',
	name: 'Hexenhäuschen 🧙‍♀️',
	property_url: 'https://www.booking.com/hotel/at/hexenhauschen.en-gb.html',
	checkin_date: '2026-07-01',
	checkout_date: '2026-07-31',
	adults: 2,
	children: 0,
	min_nights: 4,
}

console.log('Sending test stretch message...')
await sendStretches(webhookUrl, watchdog, [
	{ start: '2026-07-10', end: '2026-07-17', nights: 7 },
	{ start: '2026-07-20', end: '2026-07-25', nights: 5 },
])
console.log('Stretch message sent!')

console.log('\nSending test missing message...')
await sendMissing(
	webhookUrl,
	watchdog,
	'https://www.booking.com/city/at/test-town.html',
)
console.log('Missing message sent!')

console.log('\nSending test unknown message...')
await sendUnknown(
	webhookUrl,
	watchdog,
	{ unknown: 15, total: 212 },
	'https://github.com/test-owner/bookdog/actions/runs/1234',
)
console.log('Unknown message sent!')

console.log('\nSending test error message...')
await sendError(webhookUrl, watchdog, 'page.goto: Timeout 30000ms exceeded.')
console.log('Error message sent!')
