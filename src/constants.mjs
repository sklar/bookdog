/**
 * Constants that more than one module uses. A constant with one user stays in
 * that module, as `MAX_WINDOW_DAYS` does in `watchdog.mjs`.
 *
 * The `DEFAULT_` constants fill in a guest count or minimum nights that is
 * missing or unusable:
 *
 * - `config.mjs` uses them for a Sheet cell that is blank, zero, negative or
 *   unreadable.
 * - `watchdog.mjs` uses them for a config passed in directly that leaves a
 *   value out.
 * - `scraper.mjs` uses the minimum nights when a caller passes none.
 *
 * `GUIDE.md` repeats their numbers for the owner. Change both together.
 */

/**
 * Adults in each search. The scrape and the Slack link send it to Booking as
 * `group_adults`.
 */
export const DEFAULT_ADULTS = 1

/**
 * Children in each search. The scrape and the Slack link send it to Booking as
 * `group_children`.
 */
export const DEFAULT_CHILDREN = 0

/**
 * Length of the stay that each check-in date asks about. The scrape sets the
 * page URL's `checkout` this many nights after the check-in. So a stretch from
 * one available date is this many nights long.
 */
export const DEFAULT_MIN_NIGHTS = 3
