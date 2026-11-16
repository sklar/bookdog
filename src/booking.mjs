/**
 * Checks a watchdog's property URL, and builds the Booking link for one stay
 * for the scraper and the stretch message. If Booking renames a query
 * parameter, this file is the one place to change.
 */

import { CHILD_AGE } from './constants.mjs'

/**
 * Start of every property URL a watchdog may have. The scraper loads that URL
 * in a browser without a sandbox, on a runner that holds the Google key. So a
 * URL from the Sheet may point at Booking property pages only.
 */
export const PROPERTY_URL_START = 'https://www.booking.com/hotel/'

/**
 * Tells whether a watchdog may load this URL. The check runs on the parsed URL,
 * which has its scheme and host in lower case, so
 * `HTTPS://WWW.BOOKING.COM/hotel/` passes. A slash must follow
 * `www.booking.com`, so a look-alike host such as `www.booking.com.example.com`
 * fails.
 *
 * @param {string} url
 * @returns {boolean} `true` when the parsed URL starts with
 *   `PROPERTY_URL_START`.
 */
export function isPropertyUrl(url) {
	return URL.canParse(url) && new URL(url).href.startsWith(PROPERTY_URL_START)
}

/**
 * Builds the Booking link for one stay of the watchdog in one room, with the
 * watchdog's guests. Each child goes to Booking aged `CHILD_AGE`. Throws when
 * `property_url` isn't a valid URL.
 *
 * The link drops the query and fragment of `property_url`. A URL copied from a
 * Booking search carries its own guests, such as `room1=A,A,A,A` for 4 adults,
 * and Booking prices the rooms for those, even next to `group_adults=2`.
 *
 * @param {import('./watchdog.mjs').Watchdog} watchdog With `adults` and
 *   `children` filled in.
 * @param {object} stay
 * @param {string} stay.checkin `YYYY-MM-DD`.
 * @param {string} stay.checkout `YYYY-MM-DD`.
 * @param {string} [stay.lang] Page language, such as `en-gb`. It overrides
 *   the language in the URL's ending: Booking sends `.de.html` with `en-gb`
 *   to the `.en-gb.html` page. The scraper passes it. The stretch message
 *   doesn't, so its links keep the URL's language.
 * @returns {string} The link.
 */
export function buildBookingUrl(
	{ property_url, adults, children },
	{ checkin, checkout, lang },
) {
	const url = new URL(property_url)
	url.search = ''
	url.hash = ''
	url.searchParams.set('checkin', checkin)
	url.searchParams.set('checkout', checkout)
	url.searchParams.set('group_adults', String(adults))
	url.searchParams.set('group_children', String(children))
	for (let i = 0; i < children; i++) {
		url.searchParams.append('age', String(CHILD_AGE))
	}
	url.searchParams.set('no_rooms', '1')
	if (lang) url.searchParams.set('lang', lang)
	return url.toString()
}
