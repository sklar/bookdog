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

function humanizeName(propertyUrl) {
	const slug = propertyUrl.split('/').pop()?.replace('.html', '') || 'unknown'
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

export async function sendAlert(
	webhookUrl,
	watchdogId,
	name,
	propertyUrl,
	runs,
	adults,
	children,
) {
	const displayName = name || humanizeName(propertyUrl)

	const runLines = runs
		.map((r) => {
			const url = buildBookingUrl(
				propertyUrl,
				r.start,
				nextDay(r.end),
				adults,
				children,
			)
			return `• <${url}|${r.start} → ${r.end}> ${r.nights} nights`
		})
		.join('\n')

	const text = [
		`*${displayName}*`,
		watchdogId,
		'',
		'Found availability:',
		runLines,
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
