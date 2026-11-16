/**
 * Sends the four Slack messages: one for new stretches, one for a missing
 * property, one for too many unknown dates and one for an error.
 *
 * Each message starts with the watchdog's title and ID. Every send except
 * `sendError` throws when Slack fails, and `runWatchdog` then sends the error
 * message.
 *
 * The messages hold Sheet data. Without a webhook URL, only a verbose logger
 * prints them, and the public log says only that no message went out.
 */

import { buildBookingUrl } from './booking.mjs'

/**
 * Longest wait, in ms, for Slack to answer one message.
 *
 * Node's fetch waits up to 5 minutes for an answer. A Slack that hangs costs
 * two waits, one for the message and one for the error message. Both must fit
 * in the check job's `timeout-minutes` in `check-availability.yml`.
 */
const SLACK_TIMEOUT_MS = 10_000

/**
 * Where the messages go, and the logger that prints whether each one went out.
 *
 * @typedef {object} SlackTarget
 * @property {string} webhookUrl Slack webhook. An empty string sends nothing.
 * @property {import('./logger.mjs').Logger} logger Prints whether each message
 *   went out. Without a webhook URL, a verbose logger prints the message
 *   instead.
 */

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
 * Returns the title of each message about the watchdog.
 *
 * It's the watchdog's name, or a title from its URL when the name is blank.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @returns {string} The title.
 */
function titleOf(watchdog) {
	return watchdog.name || humanizeName(watchdog.property_url)
}

/**
 * Builds the first two lines of a message about a problem.
 *
 * The first is the title after 🚧, the second the watchdog's ID. The missing,
 * unknown and error messages start with them. The stretch message has the same
 * two lines without the 🚧.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @returns {string[]} The two lines.
 */
function problemHeader(watchdog) {
	return [`🚧 *${titleOf(watchdog)}*`, watchdog.id]
}

/**
 * Posts one message to the webhook, and logs that Slack accepted it.
 *
 * Without a webhook URL, it logs that the message wasn't sent. A verbose
 * logger then prints the message, so a check on the owner's machine shows it.
 *
 * Throws on a network failure, on an answer outside 2xx and when Slack doesn't
 * answer within `SLACK_TIMEOUT_MS`. An answer outside 2xx gives an error with
 * the status and Slack's reply, such as `404 no_service`.
 *
 * @param {SlackTarget} slack
 * @param {string} text The message.
 * @returns {Promise<void>} Resolves after Slack accepts the message, or at once
 *   without a webhook URL.
 */
async function post({ webhookUrl, logger }, text) {
	if (!webhookUrl) {
		logger.log('   No Slack webhook URL, so the message was not sent.')
		logger.detail(text)
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
	logger.log('   Slack message sent.')
}

/**
 * Sends one message that lists the new stretches.
 *
 * Each line links to Booking with the dates of that stretch and the
 * watchdog's guests.
 *
 * Throws when the send fails. `runWatchdog` then writes no state, so the next
 * check sends these stretches again.
 *
 * @param {SlackTarget} slack
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults` and
 *   `children` filled in.
 * @param {import('./stretches.mjs').Stretch[]} stretches The new stretches.
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendStretches(slack, watchdog, stretches) {
	const stretchLines = stretches
		.map((stretch) => {
			const url = buildBookingUrl(watchdog, {
				checkin: stretch.start,
				checkout: stretch.end,
			})
			return `• <${url}|${stretch.start} → ${stretch.end}> ${stretch.nights} nights`
		})
		.join('\n')

	const text = [
		`*${titleOf(watchdog)}*`,
		watchdog.id,
		'',
		'Found availability:',
		stretchLines,
	].join('\n')

	await post(slack, text)
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
 * @param {SlackTarget} slack
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {string} finalUrl Where Booking sent the property's page.
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendMissing(slack, watchdog, finalUrl) {
	const text = [
		...problemHeader(watchdog),
		`Booking no longer has this property. It sends visitors to <${finalUrl}>.`,
		'To stop this message, set enabled=FALSE in the Sheet.',
	].join('\n')

	await post(slack, text)
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
 * @param {SlackTarget} slack
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
	slack,
	watchdog,
	{ unknown, total },
	workflowRunUrl,
) {
	const lines = [
		...problemHeader(watchdog),
		`${unknown} of ${total} dates are unknown. Booking may block the scraper, or the page changed.`,
	]
	if (workflowRunUrl) lines.push(`<${workflowRunUrl}|Workflow run>`)

	await post(slack, lines.join('\n'))
}

/**
 * Sends the message for an error, with the error text in a code block.
 *
 * Never throws. `runWatchdog` calls it from its `catch`, often after Slack
 * itself failed. When this send fails too, only the log shows it, and on
 * GitHub the log shows only the error's name.
 *
 * @param {SlackTarget} slack Its logger also prints the error when the send
 *   fails.
 * @param {import('./watchdog.mjs').Watchdog} watchdog
 * @param {string} errorMessage The caught error, as `describeError` gives it.
 * @returns {Promise<void>} Resolves after the send, or after it failed.
 */
export async function sendError(slack, watchdog, errorMessage) {
	const text = [...problemHeader(watchdog), `\`\`\`${errorMessage}\`\`\``].join(
		'\n',
	)

	try {
		await post(slack, text)
	} catch (err) {
		slack.logger.error('Error message not sent', err)
	}
}
