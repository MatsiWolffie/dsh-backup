import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { listStatus, resolveEnvironment } from '../lib/engine.js'
import { createTool } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.tmp-location')
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })

const home = path.join(root, 'home')
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'desktop'

const dir = (name) => path.join(root, name)
const workspace = async (name) => {
  const target = dir(name)
  await mkdir(target, { recursive: true })
  return target
}
const store = async (workspacePath, point = '20261125-090000') => {
  const backupRoot = path.join(workspacePath, 'dsh-backups')
  await mkdir(path.join(backupRoot, 'points', point), { recursive: true })
  await writeFile(path.join(backupRoot, 'points', point, 'manifest.json'), JSON.stringify({
    format: 'dsh-desktop-restore-point',
    version: 1,
    id: point,
    createdAt: '2026-11-25T01:00:00.000Z',
    createdAtLocal: '2026-11-25 09:00:00',
    note: '',
    parts: [],
    fileCount: 0,
    totalBytes: 0,
  }, null, 2))
  await writeFile(path.join(backupRoot, 'points', point, 'marker.txt'), 'keep me')
  return backupRoot
}
const ws = (workspacePath, updatedAt = '2026-11-25T01:00:00.000Z') => ({
  path: workspacePath,
  updatedAt,
})
const context = (active, list) => ({
  get(name) {
    if (name === 'workingDirectory') return { defaultDirectory: active }
    if (name === 'workspaceRegistry') return { list: () => list }
    return undefined
  },
})
const noRegistryContext = (active) => ({
  get(name) {
    if (name === 'workingDirectory') return { defaultDirectory: active }
    return undefined
  },
})

const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === '' ? '' : ` :: ${extra}`}`)
  if (!ok) process.exitCode = 1
}

// 1. First install: no folders anywhere, create in the current workspace.
const first = await workspace('first')
let env = resolveEnvironment(context(first, [ws(first)]))
check('first install resolves a usable workspace', env.backupState === 'ready' && env.workspace === first, JSON.stringify(env))
check('first install points at the new folder', env.backupRoot === path.join(first, 'dsh-backups'), env.backupRoot)
await listStatus(env)
check('first install creates dsh-backups', existsSync(path.join(first, 'dsh-backups')))
check('first install seeds the offline program', existsSync(path.join(first, 'dsh-backups', 'restore.ps1')))

// 2. Reinstall discovers the old folder and preserves its data.
const oldStore = await store(first)
const oldMarker = path.join(oldStore, 'points', '20261125-090000', 'marker.txt')
env = resolveEnvironment(context(first, [ws(first)]))
check('reinstall finds the existing folder', env.backupState === 'ready' && env.backupRoot === oldStore, env.backupRoot)
const oldStatus = await listStatus(env)
check('reinstall keeps the existing point', oldStatus.pointCount === 1, String(oldStatus.pointCount))
check('reinstall preserves point data', (await readFile(oldMarker, 'utf8')) === 'keep me')

// 3. Current workspace has no folder; another workspace has the only one.
const second = await workspace('second')
env = resolveEnvironment(context(second, [ws(first), ws(second)]))
check('uses the unique folder from another workspace', env.backupState === 'ready' && env.backupRoot === oldStore, env.backupRoot)
check('does not create a second folder', !existsSync(path.join(second, 'dsh-backups')))

// 4. Manual migration: old path disappears, new workspace has the folder.
await rm(path.join(first, 'dsh-backups'), { recursive: true, force: true })
const migrated = await store(second)
env = resolveEnvironment(context(second, [ws(first), ws(second)]))
check('discovers a manually migrated folder', env.backupState === 'ready' && env.backupRoot === migrated, env.backupRoot)

// 5. Two folders: stop, list both, do not write or select.
const third = await workspace('third')
const thirdStore = await store(third)
env = resolveEnvironment(context(second, [ws(first), ws(second), ws(third)]))
check('two folders stop automatic selection', env.backupState === 'multiple', env.backupState)
check('multiple candidates are both reported', (env.backupCandidates ?? []).length === 2, JSON.stringify(env.backupCandidates))
const conflictStatus = await listStatus(env)
check('multiple status has no points selected', conflictStatus.pointCount === 0 && conflictStatus.backupRoot === '')
check('multiple status does not seed the program', !existsSync(path.join(second, 'dsh-backups', 'restore.ps1')) && !existsSync(path.join(thirdStore, 'restore.ps1')))
check('multiple status keeps the folders untouched', existsSync(path.join(thirdStore, 'points', '20261125-090000', 'marker.txt')))
const blockedTool = createTool(context(second, [ws(first), ws(second), ws(third)]))
const blockedToolStatus = await blockedTool.execute({ action: 'status' })
check('tool reports the conflict instead of selecting a folder', blockedToolStatus.ok === false && /Multiple backup folders/.test(blockedToolStatus.message), blockedToolStatus.message)

// 6. Removing the extra folder allows a later scan to recover.
await rm(path.join(third, 'dsh-backups'), { recursive: true, force: true })
env = resolveEnvironment(context(second, [ws(first), ws(second), ws(third)]))
check('rescan recovers after the extra folder is removed', env.backupState === 'ready' && env.backupRoot === migrated, env.backupRoot)

// 7. A stale cache-like location file must not win over the live scan.
await rm(path.join(second, 'dsh-backups'), { recursive: true, force: true })
const cached = await workspace('cached')
const cachedStore = await store(cached)
await mkdir(path.join(home, '.dsh-backup'), { recursive: true })
await writeFile(path.join(home, '.dsh-backup', 'location.json'), JSON.stringify({
  version: 1,
  workspace: second,
  backupRoot: path.join(second, 'dsh-backups'),
}))
env = resolveEnvironment(context(second, [ws(second), ws(cached)]))
check('stale absolute cache is ignored', env.backupState === 'ready' && env.backupRoot === cachedStore, env.backupRoot)

// 8. Registry unavailable: block creation instead of guessing.
const blocked = await workspace('blocked')
env = resolveEnvironment(noRegistryContext(blocked))
check('missing workspace registry blocks creation', env.backupState === 'blocked', env.backupState)
const blockedStatus = await listStatus(env)
check('blocked status is surfaced', blockedStatus.backupState === 'blocked' && blockedStatus.backupRoot === '')
check('blocked state creates no folder', !existsSync(path.join(blocked, 'dsh-backups')))

// 9. A registered workspace that cannot be checked blocks creation too.
const missing = dir('missing-workspace')
const incomplete = await workspace('incomplete')
env = resolveEnvironment(context(incomplete, [ws(incomplete), ws(missing)]))
check('unreadable/missing workspace blocks creation', env.backupState === 'blocked', env.backupState)
check('blocked scan creates no folder', !existsSync(path.join(incomplete, 'dsh-backups')))

// 10. A non-directory workspace path is treated as inaccessible, not as empty.
const notDir = path.join(root, 'not-a-directory')
await writeFile(notDir, 'file')
const fileWorkspace = await workspace('file-workspace')
env = resolveEnvironment(context(fileWorkspace, [ws(fileWorkspace), ws(notDir)]))
check('non-directory workspace blocks creation', env.backupState === 'blocked', env.backupState)
check('non-directory scan creates no folder', !existsSync(path.join(fileWorkspace, 'dsh-backups')))

// 10b. A file named dsh-backups is an invalidity, not a folder to create over.
const badBackup = await workspace('bad-backup')
await writeFile(path.join(badBackup, 'dsh-backups'), 'not a folder')
env = resolveEnvironment(context(badBackup, [ws(badBackup)]))
check('a non-directory dsh-backups blocks creation', env.backupState === 'blocked', env.backupState)
check('invalid dsh-backups is reported as an issue', (env.backupIssues ?? []).some((item) => item.backupRoot === path.join(badBackup, 'dsh-backups')))

// 11. A unique accessible folder is still usable when another workspace is missing.
const unique = await workspace('unique')
const uniqueStore = await store(unique)
env = resolveEnvironment(context(unique, [ws(unique), ws(missing)]))
check('unique folder wins even if another workspace is unavailable', env.backupState === 'ready' && env.backupRoot === uniqueStore, env.backupRoot)

// 12. Registry available but empty: current workspace is the fallback creation target.
const emptyRegistry = await workspace('empty-registry')
env = resolveEnvironment(context(emptyRegistry, []))
check('empty registry can seed the current workspace', env.backupState === 'ready' && env.backupRoot === path.join(emptyRegistry, 'dsh-backups'), env.backupRoot)
await listStatus(env)
check('empty registry creates the folder', existsSync(path.join(emptyRegistry, 'dsh-backups')))

await rm(root, { recursive: true, force: true })
