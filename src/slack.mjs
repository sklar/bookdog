/**
 * Sends the four Slack messages: one for new stretches, one for a missing
 * property, one for too many unknown dates and one for an error.
 *
 * Each message starts with the watchdog's title and ID. Every send except
 * `sendError` throws when Slack fails, and `runWatchdog` then sends the error
 * message.
 */

import { buildBookingUrl } from './booking.mjs'

/**
 * Longest wait, in ms, for Slack to answer one message.
 *
 * Node's fetch waits up to 5 minutes for an answer. A Slack that hangs costs
 * two waits, one for the message and one for the error message, and the job
 * limit is 15 minutes.
 */
const SLACK_TIMEOUT_MS = 10_000

/**
 * Builds a title from the URL, for a watchdog with no name.
 *
 * `grand-hotel.en-gb.html?aid=1` gives `Grand Hotel`. A URL that ends in a
 * slash gives `Unknown`.
 *
 * It splits the string instead of calling `new URL`, which throws on a broken
 * URL. The error message for that URL still needs a title.
 *
 * @param {string} propertyUrl The watchdog's `property_url`.
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
 * Builds the first two lines of a message about a problem. The first is the
 * title after 🚧, the second the watchdog's ID.
 *
 * The missing, unknown and error messages start with them. The stretch message
 * has the same two lines without the 🚧.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @returns {string[]} The two lines.
 */
function problemHeader(watchdog) {
	return [`🚧 *${titleOf(watchdog)}*`, watchdog.id]
}

/**
 * Posts one message to the webhook.
 *
 * Throws on a network failure, on an answer outside 2xx and when Slack doesn't
 * answer within `SLACK_TIMEOUT_MS`. An answer outside 2xx gives an error with
 * the status and Slack's reply, such as `404 no_service`.
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
 * Sends the message for a missing property.
 *
 * It links to where Booking sends visitors and says how to stop the message.
 * Unlike the error message, it has no code block, so the link stays clickable.
 *
 * Throws when the send fails. The message comes again with the next check
 * anyway, as long as the property stays missing.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {string} finalUrl Where Booking sent the property's page.
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendMissing(webhookUrl, watchdog, finalUrl) {
	const text = [
		...problemHeader(watchdog),
		`Booking no longer has this property. It sends visitors to <${finalUrl}>.`,
		'To stop this message, set enabled=FALSE in the Sheet.',
	].join('\n')

	await post(webhookUrl, text)
}

/**
 * Sends the message for too many unknown dates, with the counts and a link to
 * the workflow run.
 *
 * Like the missing message, it has no code block, so the link stays clickable.
 * The link shows `Workflow run` in place of the URL. The missing message shows
 * its URL, because there the address is the news. Here the address tells the
 * owner nothing.
 *
 * Throws when the send fails. `runWatchdog` then writes no state, so a stretch
 * message from the same check comes again with the next check.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {object} counts Passed by name, so the two counts can't swap.
 * @param {number} counts.unknown Unknown dates.
 * @param {number} counts.total Dates checked.
 * @param {string | null} workflowRunUrl Workflow run on GitHub. `null` on the
 *   owner's machine, which has no workflow run. The message then has no link
 *   line.
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendUnknown(
	webhookUrl,
	watchdog,
	{ unknown, total },
	workflowRunUrl,
) {
	const lines = [
		...problemHeader(watchdog),
		`${unknown} of ${total} dates are unknown. Booking may block the scraper, or the page changed.`,
	]
	if (workflowRunUrl) lines.push(`<${workflowRunUrl}|Workflow run>`)

	await post(webhookUrl, lines.join('\n'))
}

/**
 * Sends the message for an error, with the error text in a code block.
 *
 * Never throws. `runWatchdog` calls it from its `catch`, often after Slack
 * itself failed. When this send fails too, only the log shows it.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {string} errorMessage Text of the caught error.
 * @returns {Promise<void>} Resolves after the send, or after it failed.
 */
export async function sendError(webhookUrl, watchdog, errorMessage) {
	const text = [...problemHeader(watchdog), `\`\`\`${errorMessage}\`\`\``].join(
		'\n',
	)

	try {
		await post(webhookUrl, text)
	} catch (err) {
		console.error(`Error message not sent: ${err.message}`)
	}
}
