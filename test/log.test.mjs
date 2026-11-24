import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendLog, formatLine, logPath, tailLog } from '../lib/log.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.tmp-log')
await rm(root, { recursive: true, force: true })
const env = { backupRoot: path.join(root, 'dsh-backups') }

const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === '' ? '' : ` :: ${extra}`}`)
  if (!ok) process.exitCode = 1
}

await appendLog(env, 'info', 'backup.done', { point: '20261124-120000', bytes: 12 })
await appendLog(env, 'warn', 'part.failed', { error: 'line1\nline2' })
await appendLog(env, 'error', 'http.failed', { error: 'EACCES C:\\Users\\someone\\x' })

const text = await readFile(logPath(env), 'utf8')
check('log file created', text.length > 0)
const lines = text.trim().split('\n')
check('one line per event', lines.length === 3, lines.length)
check('newlines are collapsed', lines[1].includes('line1 line2'))
check('events recorded', text.includes('backup.done') && text.includes('part.failed'))
check('tail returns the last line', (await tailLog(env, 1)).length === 1)

const small = path.join(root, 'rotate')
for (let i = 0; i < 8; i += 1) {
  await appendLog({ backupRoot: small }, 'info', 'rotate', { n: i }, { maxBytes: 200 })
}
const rotated = await readFile(path.join(small, 'logs', 'plugin.log.1'), 'utf8')
check('rotation keeps one previous file', rotated.length > 0)
check('current file stays under the cap', (await readFile(path.join(small, 'logs', 'plugin.log'), 'utf8')).length < 400)
check('line format has timestamp, level and event',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} INFO x$/.test(formatLine('info', 'x')))

await rm(root, { recursive: true, force: true })
