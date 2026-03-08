#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'

const CHANGESET_DIR = '.changesets'

p.intro('New changeset')

const result = await p.group(
	{
		bump: () =>
			p.select({
				message: 'What type of version bump?',
				options: [
					{ value: 'patch', label: 'Patch', hint: 'bug fixes, minor tweaks' },
					{
						value: 'minor',
						label: 'Minor',
						hint: 'new features, non-breaking changes',
					},
					{
						value: 'major',
						label: 'Major',
						hint: 'breaking changes',
					},
				],
			}),
		type: () =>
			p.select({
				message: 'What kind of change is this? (press enter to skip)',
				options: [
					{ value: '', label: 'Skip', hint: 'no category' },
					{
						value: 'chore',
						label: 'Chore',
						hint: 'clean-ups, minor tweaks, not visible to user',
					},
					{
						value: 'ci',
						label: 'CI',
						hint: 'build, deploy, dependencies, workflows',
					},
					{
						value: 'doc',
						label: 'Doc',
						hint: 'documentation (README, guides)',
					},
					{
						value: 'feature',
						label: 'Feature',
						hint: 'new functionality or integration',
					},
					{ value: 'fix', label: 'Fix', hint: 'bug fix, broken link, typo' },
					{ value: 'test', label: 'Test', hint: 'test additions or changes' },
				],
			}),
		scope: () =>
			p.text({
				message: 'What area is affected? (optional, press enter to skip)',
				placeholder: 'e.g. scraper, slack, config',
			}),
		summary: () =>
			p.text({
				message: 'Short summary of the change',
				placeholder: 'Add new feature...',
				validate: (v) => {
					if (!v?.trim()) return 'Summary is required'
				},
			}),
		details: () =>
			p.text({
				message: 'Longer description (optional, markdown supported)',
				placeholder: 'Press enter to skip',
			}),
	},
	{
		onCancel: () => {
			p.cancel('Changeset cancelled.')
			process.exit(0)
		},
	},
)

const id = crypto.randomBytes(4).toString('hex')
const type = result.type || 'changeset'
const filename = `${type}-${id}.md`
const bumpLine = `bump: ${result.bump}`
const typeLine = result.type ? `type: ${result.type}` : ''
const scopeLine = result.scope?.trim() ? `scope: ${result.scope.trim()}` : ''
const content = [
	'---',
	bumpLine,
	typeLine,
	scopeLine,
	'---',
	'',
	`${result.summary.trim()}`,
	result.details?.trim() ? `\n${result.details.trim()}` : '',
	'',
]
	.filter(Boolean)
	.join('\n')

if (!fs.existsSync(CHANGESET_DIR)) {
	fs.mkdirSync(CHANGESET_DIR, { recursive: true })
}

const filepath = path.join(CHANGESET_DIR, filename)
fs.writeFileSync(filepath, content)

p.outro(`Created ${filepath}`)
