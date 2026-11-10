/**
 * Sends a sample stretch message and a sample error message to Slack, to check
 * how they look. `pnpm test.alert` runs it with the values in `.env`.
 *
 * Point `SLACK_WEBHOOK_URL` at the test channel, because the samples look like
 * real messages. Without a webhook URL, the script prints them instead.
 *
 * Usage: SLACK_WEBHOOK_URL=https://hooks.slack.com/... node tests/send-test-alert.mjs
 */
import { sendError, sendStretches } from '../src/slack.mjs'

const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''

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

console.log('Sending test alert...')
await sendStretches(webhookUrl, watchdog, [
	{ start: '2026-07-10', end: '2026-07-17', nights: 7 },
	{ start: '2026-07-20', end: '2026-07-25', nights: 5 },
])
console.log('Alert sent!')

console.log('\nSending test error...')
await sendError(
	webhookUrl,
	watchdog,
	'Playwright timeout after 30s — Booking.com may have changed DOM',
)
console.log('Error sent!')
