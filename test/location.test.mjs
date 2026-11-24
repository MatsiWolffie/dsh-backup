import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveEnvironment } from '../lib/engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.tmp-location')
await rm(root, { recursive: true, force: true })

const home = path.join(root, 'home')
const w1 = path.join(root, 'w1')
const w2 = path.join(root, 'w2')
const w3 = path.join(root, 'w3')
for (const dir of [w1, w2, w3]) await mkdir(dir, { recursive: true })
await mkdir(path.join(w1, 'dsh-backups', 'points', '20261124-100000'), { recursive: true })
await writeFile(path.join(w1, 'dsh-backups', 'points', '20261124-100000', 'manifest.json'), '{}\n')

process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'desktop'

const workshop = (dir, updatedAt) => ({ path: dir, updatedAt })
const context = (active, workspaces) => ({
  get(name) {
    if (name === 'workingDirectory') return { defaultDirectory: active }
    if (name === 'workspaceRegistry') return { list: () => workspaces }
    return undefined
  },
})

const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === '' ? '' : ` :: ${extra}`}`)
  if (!ok) process.exitCode = 1
}

// Reproduce issue #2: an old workspace already has a backup, a newer one is active.
let env = resolveEnvironment(context(w2, [
  workshop(w1, '2026-11-24T10:00:00Z'),
  workshop(w2, '2026-11-24T12:00:00Z'),
]))
check('keeps the workspace that already has backups', env.workspace === w1, env.workspace)
check('records where the location came from', env.workspaceSource === 'workspace with existing backups', env.workspaceSource)
check('writes a durable location pin', existsSync(path.join(home, '.dsh-backup', 'location.json')))
const pin = JSON.parse(await readFile(path.join(home, '.dsh-backup', 'location.json'), 'utf8'))
check('pin points at the old backup folder', pin.backupRoot === path.join(w1, 'dsh-backups'), pin.backupRoot)

// A new workspace must not steal the backup folder.
env = resolveEnvironment(context(w3, [
  workshop(w1, '2026-11-24T10:00:00Z'),
  workshop(w2, '2026-11-24T12:00:00Z'),
  workshop(w3, '2026-11-24T14:00:00Z'),
]))
check('stays pinned after a new workspace', env.workspace === w1, env.workspace)
check('stays pinned after switching the active workspace', env.workspaceSource === 'pinned location', env.workspaceSource)

// If the pinned workspace disappears, fall back and write a new pin.
await rm(w1, { recursive: true, force: true })
env = resolveEnvironment(context(w3, [
  workshop(w2, '2026-11-24T12:00:00Z'),
  workshop(w3, '2026-11-24T14:00:00Z'),
]))
check('recovers when the pinned workspace is gone', env.workspace === w3, env.workspace)
const repinned = JSON.parse(await readFile(path.join(home, '.dsh-backup', 'location.json'), 'utf8'))
check('rewrites the pin after recovery', repinned.backupRoot === path.join(w3, 'dsh-backups'), repinned.backupRoot)

// A fresh install with no backups pins its first choice and never follows new workspaces.
const home2 = path.join(root, 'home2')
process.env.DSH_HOME = home2
const w4 = path.join(root, 'w4')
const w5 = path.join(root, 'w5')
await mkdir(w4, { recursive: true })
await mkdir(w5, { recursive: true })
env = resolveEnvironment(context(w4, [workshop(w4, '2026-11-24T10:00:00Z')]))
check('pins the first choice when no backups exist', env.workspace === w4, env.workspace)
env = resolveEnvironment(context(w5, [
  workshop(w4, '2026-11-24T10:00:00Z'),
  workshop(w5, '2026-11-24T14:00:00Z'),
]))
check('does not follow a newer workspace after the first pin', env.workspace === w4, env.workspace)

await rm(root, { recursive: true, force: true })
