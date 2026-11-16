/**
 * Helpers that more than one test file uses. `pnpm test` runs only
 * `tests/*.test.mjs`, so this file holds no tests of its own.
 */

import { format } from 'node:util'

/**
 * Keeps every line printed through any console method.
 *
 * It catches a line that skips the logger too. The mocks end with the test.
 *
 * @param {import('node:test').TestContext} t
 * @returns {string[]} The lines, filled as the test runs.
 */
export function captureConsole(t) {
	const lines = []
	for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
		t.mock.method(console, method, (...args) => lines.push(format(...args)))
	}
	return lines
}
