import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deduplicateStretches, findStretches } from '../src/watchdog.mjs'

describe('findStretches', () => {
	it('one available date makes a stretch: free nights Jul 10 to 12, minimum 3', () => {
		const avail = [
			{ date: '2026-07-09', available: false },
			{ date: '2026-07-10', available: true },
			{ date: '2026-07-11', available: false },
			{ date: '2026-07-12', available: false },
		]
		assert.deepEqual(findStretches(avail, 3), [
			{ start: '2026-07-10', end: '2026-07-13', nights: 3 },
		])
	})

	it('a sequence of available dates makes one stretch: free nights Jul 10 to 14, minimum 3', () => {
		const avail = [
			{ date: '2026-07-10', available: true },
			{ date: '2026-07-11', available: true },
			{ date: '2026-07-12', available: true },
			{ date: '2026-07-13', available: false },
			{ date: '2026-07-14', available: false },
		]
		assert.deepEqual(findStretches(avail, 3), [
			{ start: '2026-07-10', end: '2026-07-15', nights: 5 },
		])
	})

	it('a sold out date stops a stretch', () => {
		const avail = [
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
			{ date: '2026-07-03', available: false },
			{ date: '2026-07-04', available: false },
			{ date: '2026-07-05', available: false },
			{ date: '2026-07-06', available: true },
			{ date: '2026-07-07', available: true },
			{ date: '2026-07-08', available: true },
		]
		assert.deepEqual(findStretches(avail, 3), [
			{ start: '2026-07-01', end: '2026-07-05', nights: 4 },
			{ start: '2026-07-06', end: '2026-07-11', nights: 5 },
		])
	})

	it('a stretch can reach the last date, across a month end', () => {
		const avail = [
			{ date: '2026-07-30', available: true },
			{ date: '2026-07-31', available: true },
		]
		assert.deepEqual(findStretches(avail, 3), [
			{ start: '2026-07-30', end: '2026-08-03', nights: 4 },
		])
	})

	it('handles unsorted input', () => {
		const avail = [
			{ date: '2026-07-03', available: true },
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
		]
		assert.deepEqual(findStretches(avail, 2), [
			{ start: '2026-07-01', end: '2026-07-05', nights: 4 },
		])
	})
})

describe('deduplicateStretches', () => {
	it('a stretch is new when it shares only its start, or only its end while a start is after today', () => {
		const cases = [
			{
				current: { start: '2026-07-01', end: '2026-07-06', nights: 5 },
				alerted: { start: '2026-07-01', end: '2026-07-05', nights: 4 },
				today: '2026-06-15',
			},
			{
				current: { start: '2026-07-05', end: '2026-07-20', nights: 15 },
				alerted: { start: '2026-07-02', end: '2026-07-20', nights: 18 },
				today: '2026-07-03',
			},
			{
				current: { start: '2026-07-12', end: '2026-07-15', nights: 3 },
				alerted: { start: '2026-07-13', end: '2026-07-15', nights: 2 },
				today: '2026-07-12',
			},
		]
		for (const { current, alerted, today } of cases) {
			assert.deepEqual(deduplicateStretches([current], [alerted], today), [
				current,
			])
		}
	})
})
