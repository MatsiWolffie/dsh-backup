import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPoint,
  deletePoint,
  ensureRestoreProgram,
  listStatus,
  resolveEnvironment,
  restorePoint,
} from '../lib/engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.tmp-engine')
await rm(root, { recursive: true, force: true })
const home = path.join(root, 'dsh-home')
const workspace = path.join(root, 'workspace')
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'desktop'

async function seed() {
  await mkdir(path.join(home, 'profiles/desktop/node_modules'), { recursive: true })
  await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: 1\n')
  await writeFile(path.join(home, 'profiles/desktop/node_modules/big.js'), 'x'.repeat(1000))
  await mkdir(path.join(home, 'sessions/s1'), { recursive: true })
  await writeFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'session-one')
  await mkdir(path.join(home, 'storages'), { recursive: true })
  await writeFile(path.join(home, 'storages/workspace.json'), '{"a":1}')
  await mkdir(path.join(home, 'attachments/v1/objects'), { recursive: true })
  await writeFile(path.join(home, 'attachments/v1/objects/blob'), 'binary')
  await writeFile(path.join(home, '.credentials.yaml'), 'version: 1\n')
  await mkdir(workspace, { recursive: true })
}

const ctx = { get: (name) => (name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined) }

const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) process.exitCode = 1
}

await seed()
const env = resolveEnvironment(ctx)
check('env home', env.home === home)
check('env backup root', env.backupRoot === path.join(workspace, 'dsh-backups'))

const status0 = await listStatus(env)
check('no points initially', status0.pointCount === 0)
check('restore program seeded', status0.restoreProgram.ready === true)
check('restore program file exists', existsSync(path.join(env.backupRoot, '恢复DSH.cmd')))
check('status reports the operation log', status0.log.path.endsWith(path.join('logs', 'plugin.log')), status0.log.path)

const first = await createPoint(env)
check('profile copied without node_modules', !existsSync(path.join(env.pointsDir, first.id, 'profile/node_modules')))
check('profile config copied', existsSync(path.join(env.pointsDir, first.id, 'profile/cordis.patch.yml')))
check('sessions copied', existsSync(path.join(env.pointsDir, first.id, 'sessions/s1/session.v4.jsonl.zstd')))
check('credentials not copied by default', !existsSync(path.join(env.pointsDir, first.id, 'credentials')))
check('backup folder carries a .gitignore guard', existsSync(path.join(env.backupRoot, '.gitignore')))
check('manifest written', existsSync(path.join(env.pointsDir, first.id, 'manifest.json')))
check('manifest excludes node_modules size', first.fileCount >= 4)
const logText = await readFile(path.join(env.backupRoot, 'logs', 'plugin.log'), 'utf8')
check('backup operation logged', logText.includes('backup.done'))
check('status log size grows after a backup', (await listStatus(env)).log.size > 0)
check('log does not contain credential contents', !logText.includes('version: 1'))

// Sign-in records are opt-in, and the manifest records the choice.
const withCredentials = await createPoint(env, { includeCredentials: true })
check('credentials copied when requested', existsSync(path.join(env.pointsDir, withCredentials.id, 'credentials')))
check('manifest records credentials choice', withCredentials.includesCredentials === true)
check('default point records no credentials', first.includesCredentials === false)
const statusCred = await listStatus(env)
check('status exposes the credentials flag', statusCred.points.find(point => point.id === withCredentials.id)?.includesCredentials === true)

// Change live data after the point, then restore it.
await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: 2\n')
await writeFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'changed')
const restored = await restorePoint(env, first.id)
check('restore reports ok', restored.ok === true)
check('restore created safety point', typeof restored.safetyPoint === 'string' && restored.safetyPoint.length > 0)
check('config restored', (await readFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'utf8')) === 'version: 1\n')
check('sessions restored', (await readFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'utf8')) === 'session-one')
check('restore receipt written', existsSync(path.join(home, '.dsh-backup/last-restore.json')))
const logAfterRestore = await readFile(path.join(env.backupRoot, 'logs', 'plugin.log'), 'utf8')
check('restore operation logged', logAfterRestore.includes('restore.done'))
check('safety point restorable', existsSync(path.join(env.pointsDir, restored.safetyPoint, 'manifest.json')))

const status1 = await listStatus(env)
check('points after restore', status1.pointCount === 3)
check('newest first', status1.points[0].id === restored.safetyPoint)

// A live session's log must be left alone while DSH still owns it.
const second = await createPoint(env)
await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: 3\n')
await writeFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'appended-after-point')
const liveRestore = await restorePoint(env, second.id, { liveSessionIds: ['s1'] })
check('live restore ok', liveRestore.ok === true)
check('config restored with live session', (await readFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'utf8')) === 'version: 1\n')
check('live session kept', (await readFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'utf8')) === 'appended-after-point')
check('skipped live session reported', liveRestore.skippedLiveSessions.includes('s1'))

const deleted = await deletePoint(env, first.id)
check('delete ok', deleted.ok === true)
check('delete removed folder', !existsSync(path.join(env.pointsDir, first.id)))
const status2 = await listStatus(env)
check('remaining points after delete', status2.pointCount === status1.pointCount + 1)
check('deleted point gone', status2.points.every((point) => point.id !== first.id))

// Regenerating the program keeps the folder tidy.
await rm(path.join(env.backupRoot, 'restore.ps1'))
const repaired = await ensureRestoreProgram(env)
check('prepare rewrites missing program', repaired.written === 1)

// A point id that tries to escape the points directory is refused.
let refused = false
try {
  await restorePoint(env, '../../etc')
} catch {
  refused = true
}
check('path traversal refused', refused)

console.log('backup root:', env.backupRoot)

await rm(root, { recursive: true, force: true })
