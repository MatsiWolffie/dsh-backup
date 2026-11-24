import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildDiagnostics } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.tmp-diag')
await rm(root, { recursive: true, force: true })

const home = path.join(root, 'home')
const backupRoot = path.join(home, 'dsh-backups')
await mkdir(path.join(backupRoot, 'points'), { recursive: true })
await mkdir(path.join(home, '.dsh-backup'), { recursive: true })

// Shape written by the offline PowerShell program on Windows: UTF-8 BOM and
// single-element arrays collapsed to objects by ConvertTo-Json.
const receipt = {
  restoredAt: '2026-11-24T12:00:00.000Z',
  point: { id: 'offline-1', createdAt: '2026-11-24T11:00:00.000Z', note: '' },
  safetyPoint: 'safety-1',
  ok: true,
  results: { id: 'profile', label: 'DSH 配置 (profile)', ok: true, message: '' },
  skippedLiveSessions: 'session-1',
}
await writeFile(path.join(home, '.dsh-backup', 'last-restore.json'), `\uFEFF${JSON.stringify(receipt)}`, 'utf8')

const env = {
  home,
  backupRoot,
  pointsDir: path.join(backupRoot, 'points'),
  profile: 'desktop',
  workspace: path.join(home, 'workspace'),
}

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const report = await buildDiagnostics(env)
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === '' ? '' : ` :: ${extra}`}`)
  if (!ok) process.exitCode = 1
}

check('report names the plugin version', report.includes(`插件版本: ${version}`))
check('reads a BOM receipt', report.includes('point=offline-1'))
check('normalizes a single result object', report.includes('failed=0'))
check('normalizes a single skipped session', report.includes('skipped=1'))
check('redacts the home directory', report.includes('%USERPROFILE%') && !report.includes(home))
check('includes the log path', report.includes(path.join('logs', 'plugin.log')))

await rm(root, { recursive: true, force: true })
