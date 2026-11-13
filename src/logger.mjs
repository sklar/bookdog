/**
 * Builds the logger that the CLIs print through.
 *
 * The repo and its Actions logs are public, so on GitHub the log holds no
 * Sheet data: no name, URL, id or date of a watchdog. The row number and
 * counts are fine. The Slack messages hold the detail.
 *
 * Outside CI the logger is verbose, so a check on the owner's machine also
 * prints dates, URLs and error messages.
 */

/**
 * Prints the lines of a check, and keeps Sheet data out of the public log.
 *
 * Code that logs takes a logger and prints every line through it. The method
 * it calls decides whether the public log gets the line.
 *
 * @typedef {object} Logger
 * @property {(line: string) => void} log Prints a line that holds no Sheet
 *   data, such as a count.
 * @property {(line: string) => void} detail Prints a line only when verbose,
 *   so the line may hold Sheet data.
 * @property {(line: string, err?: unknown) => void} error Prints `line` to
 *   stderr. Like a `log` line, it holds no Sheet data. With `err`, a verbose
 *   logger adds the error's message and cause, and any other logger only its
 *   name. A message can hold a URL, as Playwright's do. A JSON parse error
 *   quotes part of the text it failed on, such as a state cell.
 */

/**
 * Tells whether the code runs outside CI, as on the owner's machine.
 *
 * GitHub Actions sets `CI` on every runner. `CI=false` counts as CI too,
 * which only makes the log quieter.
 *
 * @returns {boolean} `true` when `CI` is unset or empty.
 */
export function isOutsideCi() {
	return !process.env.CI
}

/**
 * Describes a caught value for a verbose log and for the error message in
 * Slack.
 *
 * An error gives its message, or its name when the message is empty. Its
 * cause follows in parentheses, because fetch puts the reason it failed
 * there, as in `fetch failed (connect ECONNREFUSED 127.0.0.1:443)`. Only the
 * first cause counts.
 *
 * It leaves out a cause that the message already holds. The Sheets client's
 * message ends in the reason, and its cause repeats the message.
 *
 * Any other value, such as a thrown string, prints as it is.
 *
 * @param {unknown} err The caught value.
 * @returns {string} The description.
 */
export function describeError(err) {
	if (!(err instanceof Error)) return String(err)
	const message = err.message || err.name
	const cause = err.cause instanceof Error ? err.cause.message : ''
	if (!cause || message.includes(cause)) return message
	return `${message} (${cause})`
}

/**
 * Names a caught value for the public log.
 *
 * An error's name says what kind it is, such as `TypeError`, and holds no
 * Sheet data. Any other value gives `Error`, because it could hold anything.
 *
 * @param {unknown} err The caught value.
 * @returns {string} The name.
 */
function nameOf(err) {
	return err instanceof Error ? err.name : 'Error'
}

/**
 * Builds a logger that prints to the console.
 *
 * @param {boolean} verbose `true` prints Sheet data too. The CLIs pass
 *   `isOutsideCi()`.
 * @returns {Logger} The logger.
 */
export function createLogger(verbose) {
	// Each method reads `console` when it prints, not when `createLogger`
	// runs. So a test can build a logger when its file loads and mock the
	// console later, as scraper.test.mjs does.
	return {
		log: (line) => console.log(line),
		detail: (line) => {
			if (verbose) console.log(line)
		},
		error: (line, err) => {
			if (err === undefined) {
				console.error(line)
				return
			}
			const description = verbose ? describeError(err) : nameOf(err)
			console.error(`${line}: ${description}`)
		},
	}
}
