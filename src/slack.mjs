/**
 * Sends the Slack messages: one for new stretches, one for a missing property
 * and one for errors.
 */

import { buildBookingUrl } from './booking.mjs'

// Node's fetch waits up to 5 minutes for an answer. A Slack that hangs costs
// two waits, one for the message and one for the error message, and the job
// limit is 15 minutes.
const SLACK_TIMEOUT_MS = 10_000

/**
 * Builds a title from the URL, for a watchdog with no name.
 * `grand-hotel.en-gb.html?aid=1` gives `Grand Hotel`. A URL that ends in a
 * slash gives `Unknown`.
 *
 * It splits the string instead of calling `new URL`, which throws on a broken
 * URL. The error message for that URL still needs a title.
 *
 * @param {string} propertyUrl
 * @returns {string} The title.
 */
function humanizeName(propertyUrl) {
	const path = propertyUrl.split(/[?#]/)[0]
	// The slug ends at the first dot, before the language code and `.html`
	const slug = path.split('/').pop().split('.')[0] || 'unknown'
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

/**
 * Returns the watchdog's name, which titles each message. A watchdog with no
 * name gets a title from its URL.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @returns {string} The title.
 */
function titleOf(watchdog) {
	return watchdog.name || humanizeName(watchdog.property_url)
}

/**
 * Posts one message. Throws on a network failure, on an answer outside 2xx and
 * when Slack doesn't answer within `SLACK_TIMEOUT_MS`. An answer outside 2xx
 * gives an error with the status and Slack's reply, such as `404 no_service`.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {string} text The message.
 * @returns {Promise<void>} Resolves after Slack accepts the message, or after
 *   the print.
 */
async function post(webhookUrl, text) {
	if (!webhookUrl) {
		console.log(text)
		return
	}

	const res = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
	})

	if (!res.ok) {
		throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`)
	}
}

/**
 * Sends one message that lists the new stretches. Each line links to Booking
 * with the dates of that stretch and the watchdog's guests.
 *
 * Throws when the send fails. `runWatchdog` then writes no state, so the next
 * check sends these stretches again.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults` and
 *   `children` filled in.
 * @param {import('./watchdog.mjs').Stretch[]} stretches The new stretches.
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendStretches(webhookUrl, watchdog, stretches) {
	const { id, property_url, adults, children } = watchdog

	const stretchLines = stretches
		.map((stretch) => {
			const url = buildBookingUrl(property_url, {
				checkin: stretch.start,
				checkout: stretch.end,
				adults,
				children,
			})
			return `• <${url}|${stretch.start} → ${stretch.end}> ${stretch.nights} nights`
		})
		.join('\n')

	const text = [
		`*${titleOf(watchdog)}*`,
		id,
		'',
		'Found availability:',
		stretchLines,
	].join('\n')

	await post(webhookUrl, text)
}

/**
 * Sends the message for a missing property. It links to where Booking sends
 * visitors and says how to stop the message. Unlike the error message, it has
 * no code block, so the link stays clickable.
 *
 * Throws when the send fails.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {string} finalUrl Where Booking sent the property's page.
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendMissing(webhookUrl, watchdog, finalUrl) {
	const text = [
		`🚧 *${titleOf(watchdog)}*`,
		watchdog.id,
		`Booking no longer has this property. It sends visitors to <${finalUrl}>.`,
		'To stop this message, set enabled=FALSE in the Sheet.',
	].join('\n')

	await post(webhookUrl, text)
}

/**
 * Sends the message for an error, with the error text in a code block. Never
 * throws. `runWatchdog` calls it from its `catch`, often after Slack itself
 * failed, so a failed send only goes to the log.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {string} errorMessage
 * @returns {Promise<void>} Resolves after the send, or after it failed.
 */
export async function sendError(webhookUrl, watchdog, errorMessage) {
	const text = [
		`🚧 *${titleOf(watchdog)}*`,
		watchdog.id,
		`\`\`\`${errorMessage}\`\`\``,
	].join('\n')

	try {
		await post(webhookUrl, text)
	} catch (err) {
		console.error(`Error message not sent: ${err.message}`)
	}
}
