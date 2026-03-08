/**
 * Dev utility: send a fake Slack alert to test message formatting.
 * Usage: SLACK_WEBHOOK_URL=https://hooks.slack.com/... node tests/send-test-alert.mjs
 */
import { sendAlert, sendError } from '../src/slack.mjs'

const webhookUrl = process.env.SLACK_WEBHOOK_URL || ''

console.log('Sending test alert...')
await sendAlert(
	webhookUrl,
	'hexenhauschen-20260701-20260731-4N2A0C',
	'Hexenhäuschen 🧙‍♀️',
	'https://www.booking.com/hotel/at/hexenhauschen.en-gb.html',
	[
		{ start: '2026-07-10', end: '2026-07-16', nights: 7 },
		{ start: '2026-07-20', end: '2026-07-24', nights: 5 },
	],
	2,
	0,
)
console.log('Alert sent!')

console.log('\nSending test error...')
await sendError(
	webhookUrl,
	'hexenhauschen-20260701-20260731-4N2A0C',
	'Hexenhäuschen 🧙‍♀️',
	'Playwright timeout after 30s — Booking.com may have changed DOM',
)
console.log('Error sent!')
