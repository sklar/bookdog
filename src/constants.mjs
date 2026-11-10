/**
 * Values of each Booking search that the owner may want to change. A limit
 * such as `MAX_WINDOW_DAYS` stays in the module that checks it.
 *
 * The `DEFAULT_` constants fill in a guest count or minimum nights that is
 * missing or unusable:
 *
 * - `config.mjs` uses them for a Sheet cell that is blank, zero, negative or
 *   unreadable.
 * - `watchdog.mjs` uses them for a watchdog passed in directly that leaves a
 *   value out, as the Integration Test and local checks can.
 *
 * `GUIDE.md` repeats every number here for the owner. Change both together.
 */

/**
 * Adults for a watchdog without a usable count. Booking gets the count as
 * `group_adults`.
 */
export const DEFAULT_ADULTS = 1

/**
 * Children for a watchdog without a usable count. Booking gets the count as
 * `group_children`, plus one `age` of `CHILD_AGE` for each child.
 */
export const DEFAULT_CHILDREN = 0

/**
 * Minimum nights for a watchdog without a usable number. Each check-in date
 * asks Booking for a stay of the minimum nights, with `checkout` that many
 * nights after the check-in. So a stretch from one available date is that long.
 */
export const DEFAULT_MIN_NIGHTS = 3

/**
 * Age of each child in each search, because the Sheet has no ages. The scrape
 * and the Slack link send one `age` for each child. Booking doesn't count a
 * child without an age. On the test property, 1 child without an age gave the
 * same rooms and prices as none. The owner picked 13 on 2026-11-10.
 */
export const CHILD_AGE = 13
