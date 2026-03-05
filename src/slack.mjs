/**
 * Slack notification helpers.
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

function nextDay(dateStr) {
	const d = new Date(`${dateStr}T00:00:00Z`)
	d.setUTCDate(d.getUTCDate() + 1)
	return d.toISOString().slice(0, 10)
}

export async function sendAlert(
	webhookUrl,
	watchdogId,
	propertyUrl,
	runs,
	adults,
	children,
) {
	const bestRun = runs.reduce((a, b) => (b.nights > a.nights ? b : a))
	const bookingUrl = buildBookingUrl(
		propertyUrl,
		bestRun.start,
		nextDay(bestRun.end),
		adults,
		children,
	)
	const hotelName =
		propertyUrl.split('/').pop()?.replace('.html', '') || 'unknown'

	const runLines = runs
		.map((r) => `• ${r.start} → ${r.end} _(${r.nights} nights)_`)
		.join('\n')

	const text = [
		`👋 *${watchdogId}*`,
		`Property: <${propertyUrl}|${hotelName}>`,
		'',
		'Found availability:',
		runLines,
		'',
		`<${bookingUrl}|Book the best window (${bestRun.nights} nights)>`,
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

export async function sendError(webhookUrl, watchdogId, errorMessage) {
	const text = [
		`🚧 *${watchdogId}*`,
		`Check out the actions log!`,
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
