import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deduplicateRuns, findConsecutiveRuns } from '../src/check.mjs'

describe('findConsecutiveRuns', () => {
	it('returns one big run when all dates available', () => {
		const avail = [
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
			{ date: '2026-07-03', available: true },
			{ date: '2026-07-04', available: true },
			{ date: '2026-07-05', available: true },
		]
		const runs = findConsecutiveRuns(avail, 3)
		assert.equal(runs.length, 1)
		assert.equal(runs[0].start, '2026-07-01')
		assert.equal(runs[0].end, '2026-07-05')
		assert.equal(runs[0].nights, 5)
	})

	it('returns empty when all blocked', () => {
		const avail = [
			{ date: '2026-07-01', available: false },
			{ date: '2026-07-02', available: false },
			{ date: '2026-07-03', available: false },
		]
		assert.equal(findConsecutiveRuns(avail, 2).length, 0)
	})

	it('finds multiple runs with gaps', () => {
		const avail = [
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
			{ date: '2026-07-03', available: true },
			{ date: '2026-07-04', available: false },
			{ date: '2026-07-05', available: true },
			{ date: '2026-07-06', available: true },
			{ date: '2026-07-07', available: true },
			{ date: '2026-07-08', available: true },
		]
		const runs = findConsecutiveRuns(avail, 3)
		assert.equal(runs.length, 2)
		assert.equal(runs[0].nights, 3)
		assert.equal(runs[1].nights, 4)
	})

	it('excludes runs shorter than minNights', () => {
		const avail = [
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
			{ date: '2026-07-03', available: false },
			{ date: '2026-07-04', available: true },
		]
		const runs = findConsecutiveRuns(avail, 3)
		assert.equal(runs.length, 0)
	})

	it('includes run with exactly minNights', () => {
		const avail = [
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
			{ date: '2026-07-03', available: true },
		]
		const runs = findConsecutiveRuns(avail, 3)
		assert.equal(runs.length, 1)
		assert.equal(runs[0].nights, 3)
	})

	it('handles unsorted input', () => {
		const avail = [
			{ date: '2026-07-03', available: true },
			{ date: '2026-07-01', available: true },
			{ date: '2026-07-02', available: true },
		]
		const runs = findConsecutiveRuns(avail, 2)
		assert.equal(runs.length, 1)
		assert.equal(runs[0].start, '2026-07-01')
	})
})

describe('deduplicateRuns', () => {
	it('filters out already-alerted runs', () => {
		const current = [
			{ start: '2026-07-01', end: '2026-07-05', nights: 5 },
			{ start: '2026-07-10', end: '2026-07-14', nights: 5 },
		]
		const alerted = [{ start: '2026-07-01', end: '2026-07-05', nights: 5 }]
		const newRuns = deduplicateRuns(current, alerted)
		assert.equal(newRuns.length, 1)
		assert.equal(newRuns[0].start, '2026-07-10')
	})

	it('returns all runs when none previously alerted', () => {
		const current = [{ start: '2026-07-01', end: '2026-07-05', nights: 5 }]
		const newRuns = deduplicateRuns(current, [])
		assert.equal(newRuns.length, 1)
	})

	it('returns empty when all already alerted', () => {
		const current = [{ start: '2026-07-01', end: '2026-07-05', nights: 5 }]
		const alerted = [{ start: '2026-07-01', end: '2026-07-05', nights: 5 }]
		assert.equal(deduplicateRuns(current, alerted).length, 0)
	})
})
