/**
 * Sends the two Slack messages, one for new stretches and one for errors.
 */

/**
 * Builds the Booking link for one stay, with its dates and guests filled in.
 * These values replace any that `propertyUrl` already has.
 *
 * @param {string} propertyUrl
 * @param {string} checkin `YYYY-MM-DD`.
 * @param {string} checkout `YYYY-MM-DD`.
 * @param {number} adults
 * @param {number} children
 * @returns {string} The link.
 */
function buildBookingUrl(propertyUrl, checkin, checkout, adults, children) {
	const url = new URL(propertyUrl)
	url.searchParams.set('checkin', checkin)
	url.searchParams.set('checkout', checkout)
	url.searchParams.set('group_adults', String(adults))
	url.searchParams.set('group_children', String(children))
	url.searchParams.set('no_rooms', '1')
	return url.toString()
}

/**
 * Builds a title from the URL, for a watchdog with no name. `grand-hotel.html`
 * gives `Grand Hotel`. A language code or query string stays in the title, and
 * a URL that ends in a slash gives `Unknown`.
 *
 * @param {string} propertyUrl
 * @returns {string} The title.
 */
function humanizeName(propertyUrl) {
	const slug = propertyUrl.split('/').pop()?.replace('.html', '') || 'unknown'
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

/**
 * Sends one message that lists the new stretches. Each line links to Booking
 * with the dates of that stretch.
 *
 * Throws when the send fails. `runWatchdog` then writes no state, so the next
 * check sends these stretches again.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {string} watchdogId
 * @param {string | undefined} name Title of the message. Without one, the title
 *   comes from the URL.
 * @param {string} propertyUrl
 * @param {import('./watchdog.mjs').Stretch[]} stretches The new stretches.
 * @param {number} adults
 * @param {number} children
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendAlert(
	webhookUrl,
	watchdogId,
	name,
	propertyUrl,
	stretches,
	adults,
	children,
) {
	const displayName = name || humanizeName(propertyUrl)

	const stretchLines = stretches
		.map((stretch) => {
			const url = buildBookingUrl(
				propertyUrl,
				stretch.start,
				stretch.end,
				adults,
				children,
			)
			return `• <${url}|${stretch.start} → ${stretch.end}> ${stretch.nights} nights`
		})
		.join('\n')

	const text = [
		`*${displayName}*`,
		watchdogId,
		'',
		'Found availability:',
		stretchLines,
	].join('\n')

	if (!webhookUrl) {
		console.log(text)
		return
	}

	const res = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text }),
	})

	if (!res.ok) {
		throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`)
	}
}

/**
 * Sends the message for an error. A Slack error response only goes to the log.
 * A network failure still throws, and `runWatchdog` catches it.
 *
 * @param {string} webhookUrl Slack webhook. An empty string prints the message
 *   instead.
 * @param {string} watchdogId
 * @param {string | undefined} name Title of the message. Without one, the title
 *   is `watchdogId`.
 * @param {string} errorMessage
 * @returns {Promise<void>} Resolves after the send.
 */
export async function sendError(webhookUrl, watchdogId, name, errorMessage) {
	const displayName = name || watchdogId
	const text = [
		`🚧 *${displayName}*`,
		watchdogId,
		`\`\`\`${errorMessage}\`\`\``,
	].join('\n')

	if (!webhookUrl) {
		console.log(text)
		return
	}

	const res = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text }),
	})

	if (!res.ok) {
		console.error(`Slack error webhook failed: ${res.status}`)
	}
}
