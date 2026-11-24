/**
 * Backup engine for the DSH desktop profile.
 *
 * What a restore point holds, and why:
 * - `profiles/<name>` — the profile's own configuration (`cordis.yml`,
 *   `cordis.patch.yml`, `package.json`, lockfile, marketplace state). Its
 *   `node_modules` is excluded: packages are reinstallable, and a linked
 *   plugin tree is big and machine-specific.
 * - `sessions` — the session logs (one zstd stream per session).
 * - `storages` — plugin-owned local storage (projection caches, workspace list).
 * - `attachments` — images and files pasted into sessions.
 * - `.credentials.yaml` — the local sign-in records; a restored app needs them
 *   to be signed in again. Stored in plain text inside the workspace, which the
 *   UI states plainly.
 *
 * A restore point is a plain directory, not an archive: both the in-app
 * restore and the offline PowerShell program can copy it without unzip tools.
 */

import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendLog, logInfo } from './log.js'

/** Folder under the workspace that holds every restore point and the offline program. */
export const BACKUP_FOLDER = 'dsh-backups'
/** Manifest schema of a restore point. */
export const POINT_FORMAT = 'dsh-desktop-restore-point'
export const POINT_VERSION = 1

const RESTORE_ASSET_DIR = fileURLToPath(new URL('../restore/', import.meta.url))
const RESTORE_ASSETS = [
  ['restore.ps1', 'restore.ps1'],
  ['恢复DSH.cmd', '恢复DSH.cmd'],
  ['使用说明.md', '使用说明.md'],
  ['gitignore.txt', '.gitignore'],
]

/** Whether a directory sits inside the DSH home, where a backup folder must never go. */
function insideHome(home, candidate) {
  const normalized = path.resolve(candidate).toLowerCase()
  const root = path.resolve(home).toLowerCase()
  return normalized === root || normalized.startsWith(`${root}${path.sep}`)
}

/**
 * Pick the workspace that holds the backup folder.
 *
 * The plugin page is not bound to one Session, so "the workspace" is decided in
 * this order: the host's own working directory when it is a real workspace (a
 * Desktop launch starts in the profile directory, which is refused), then the
 * most recently used registered workspace, then any registered workspace, and
 * finally a folder beside the user's home so the plugin still works on a headless
 * host without a workspace registry.
 */
function resolveWorkspace(ctx, home) {
  const usable = (candidate) => typeof candidate === 'string'
    && candidate.trim() !== ''
    && !insideHome(home, candidate)
  const cwd = process.cwd()
  if (usable(cwd)) return { workspace: cwd, source: 'process.cwd()' }
  let workspaces = []
  try {
    workspaces = ctx.get('workspaceRegistry')?.list() ?? []
  } catch {
    workspaces = []
  }
  const live = workspaces.filter((workspace) => usable(workspace.path) && existsSync(workspace.path))
  if (live.length > 0) {
    const newest = [...live].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
    return { workspace: newest.path, source: 'workspaceRegistry (most recently used)' }
  }
  return { workspace: path.join(homedir(), 'DSH-workspace'), source: 'home fallback' }
}

/** Host facts the engine resolves lazily, so a moved workspace is honoured. */
export function resolveEnvironment(ctx) {
  const home = (process.env.DSH_HOME ?? '').trim() !== '' ? process.env.DSH_HOME.trim() : path.join(homedir(), '.dsh')
  const profile = (process.env.DSH_PROFILE ?? '').trim() !== '' ? process.env.DSH_PROFILE.trim() : 'desktop'
  let resolved = { workspace: process.cwd(), source: 'process.cwd()' }
  try {
    const working = ctx.get('workingDirectory')?.defaultDirectory
    if (typeof working === 'string' && working !== '' && !insideHome(home, working)) {
      resolved = { workspace: working, source: 'workingDirectory.defaultDirectory' }
    } else {
      resolved = resolveWorkspace(ctx, home)
    }
  } catch {
    resolved = resolveWorkspace(ctx, home)
  }
  const backupRoot = path.join(resolved.workspace, BACKUP_FOLDER)
  return {
    home,
    profile,
    workspace: resolved.workspace,
    workspaceSource: resolved.source,
    backupRoot,
    pointsDir: path.join(backupRoot, 'points'),
  }
}

/**
 * The parts one restore point carries: where they come from and where a restore
 * puts them. The sign-in records are the only sensitive part, so they are opt-in:
 * a public plugin must not copy plaintext credentials out of `DSH_HOME` by default.
 */
export function partDefinitions(env, { includeCredentials = false } = {}) {
  const parts = [
    {
      id: 'profile',
      label: 'DSH 配置 (profile)',
      kind: 'dir',
      source: path.join(env.home, 'profiles', env.profile),
      target: `profiles/${env.profile}`,
    },
    { id: 'sessions', label: '会话记录', kind: 'dir', source: path.join(env.home, 'sessions'), target: 'sessions' },
    { id: 'storages', label: '本机存储', kind: 'dir', source: path.join(env.home, 'storages'), target: 'storages' },
    { id: 'attachments', label: '附件', kind: 'dir', source: path.join(env.home, 'attachments'), target: 'attachments' },
  ]
  if (includeCredentials) {
    parts.push({
      id: 'credentials',
      label: '登录凭据',
      kind: 'file',
      source: path.join(env.home, '.credentials.yaml'),
      target: '.credentials.yaml',
    })
  }
  return parts
}

/** Skip the reinstallable dependency tree and the bulky append-only logs while copying the profile. */
function profileFilter(part) {
  if (part.id !== 'profile') return undefined
  return (source) => {
    const base = path.basename(source)
    if (base === 'node_modules') return false
    if (base.endsWith('.log')) return false
    const normalized = source.split(path.sep).join('/')
    if (normalized.includes('/.plugin-manager/logs')) return false
    if (normalized.endsWith('/.dsh-market/log.ndjson')) return false
    return true
  }
}

function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function localText(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Count files and bytes under one copied part (or one file). */
async function measure(target) {
  const info = await stat(target)
  if (info.isFile()) return { files: 1, bytes: info.size }
  let files = 0
  let bytes = 0
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const child = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) {
        files += 1
        bytes += (await stat(child)).size
      }
    }
  }
  await walk(target)
  return { files, bytes }
}

async function uniquePointId(env, base) {
  await mkdir(env.pointsDir, { recursive: true })
  let id = base
  let index = 1
  while (existsSync(path.join(env.pointsDir, id))) {
    index += 1
    id = `${base}-${index}`
  }
  return id
}

/** Refuse ids that could escape the points directory. */
function assertPointId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('invalid point id')
  return id
}

function pointDirOf(env, id) {
  return path.join(env.pointsDir, assertPointId(id))
}

/** Copy the offline restore program into the backup folder, refreshing stale copies only. */
export async function ensureRestoreProgram(env) {
  await mkdir(env.backupRoot, { recursive: true })
  let written = 0
  for (const [asset, name] of RESTORE_ASSETS) {
    const from = path.join(RESTORE_ASSET_DIR, asset)
    const to = path.join(env.backupRoot, name)
    let next
    try {
      next = await readFile(from)
    } catch {
      continue
    }
    let current
    try {
      current = await readFile(to)
    } catch {
      current = undefined
    }
    if (current !== undefined && current.equals(next)) continue
    await writeFile(to, next)
    written += 1
  }
  if (written > 0) await appendLog(env, 'info', 'program.refreshed', { files: written })
  return { written, paths: RESTORE_ASSETS.map(([, name]) => path.join(env.backupRoot, name)) }
}

/** Read one restore point's manifest, tolerating a point that was interrupted while being written. */
async function readManifest(env, id) {
  try {
    const text = await readFile(path.join(pointDirOf(env, id), 'manifest.json'), 'utf8')
    const manifest = JSON.parse(text)
    if (manifest?.format !== POINT_FORMAT) return undefined
    return manifest
  } catch {
    return undefined
  }
}

/** Create one restore point and return its manifest. */
export async function createPoint(env, { note = '', noteKind = '', noteParam = '', includeCredentials = false } = {}) {
  const id = await uniquePointId(env, stamp())
  const dir = pointDirOf(env, id)
  const createdAt = new Date().toISOString()
  const startedAt = Date.now()
  const auto = noteKind === 'auto-before-restore'
  await appendLog(env, 'info', 'backup.start', { auto, credentials: includeCredentials === true })
  await mkdir(dir, { recursive: true })
  const parts = []
  try {
    for (const part of partDefinitions(env, { includeCredentials })) {
      const entry = { id: part.id, label: part.label, kind: part.kind, target: part.target }
      if (!existsSync(part.source)) {
        parts.push({ ...entry, missing: true, files: 0, bytes: 0 })
        continue
      }
      const destination = path.join(dir, part.id)
      if (part.kind === 'file') await cp(part.source, destination, { force: true })
      else await cp(part.source, destination, { recursive: true, force: true, filter: profileFilter(part) })
      const size = await measure(destination)
      parts.push({ ...entry, ...size })
    }
    const manifest = {
      format: POINT_FORMAT,
      version: POINT_VERSION,
      id,
      createdAt,
      createdAtLocal: localText(createdAt),
      note: String(note ?? '').slice(0, 200),
      noteKind: String(noteKind ?? ''),
      noteParam: String(noteParam ?? ''),
      includesCredentials: includeCredentials === true,
      dsh: { home: env.home, profile: env.profile, workspace: env.workspace },
      totalBytes: parts.reduce((sum, part) => sum + (part.bytes ?? 0), 0),
      fileCount: parts.reduce((sum, part) => sum + (part.files ?? 0), 0),
      parts,
    }
    await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    // Every backup folder must be restorable on its own, so the offline program
    // is refreshed as part of writing a point.
    await ensureRestoreProgram(env).catch(() => {})
    await appendLog(env, 'info', 'backup.done', {
      point: id,
      auto,
      files: manifest.fileCount,
      bytes: manifest.totalBytes,
      ms: Date.now() - startedAt,
      credentials: includeCredentials === true,
    })
    return manifest
  } catch (error) {
    // A half-written point must not look restorable; keep the directory only for inspection.
    try {
      await writeFile(path.join(dir, 'FAILED.txt'), `${error instanceof Error ? error.message : String(error)}\n`, 'utf8')
    } catch {
      /* ignore */
    }
    await appendLog(env, 'error', 'backup.failed', {
      auto,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/** Every restore point, newest first. */
export async function listPoints(env) {
  let entries = []
  try {
    entries = await readdir(env.pointsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const points = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = await readManifest(env, entry.name)
    if (manifest === undefined) continue
    points.push({
      id: manifest.id,
      createdAt: manifest.createdAt,
      createdAtLocal: manifest.createdAtLocal ?? localText(manifest.createdAt),
      note: manifest.note ?? '',
      noteKind: manifest.noteKind ?? '',
      noteParam: manifest.noteParam ?? '',
      includesCredentials: manifest.includesCredentials === true
        || (manifest.parts ?? []).some((part) => part.id === 'credentials' && part.missing !== true),
      totalBytes: manifest.totalBytes ?? 0,
      fileCount: manifest.fileCount ?? 0,
      parts: (manifest.parts ?? []).filter((part) => part.missing !== true).length,
    })
  }
  points.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return points
}

export async function listStatus(env) {
  const points = await listPoints(env)
  const program = await ensureRestoreProgram(env).catch(() => ({ written: 0, paths: [] }))
  const log = await logInfo(env)
  return {
    ok: true,
    backupRoot: env.backupRoot,
    pointsDir: env.pointsDir,
    home: env.home,
    profile: env.profile,
    points,
    pointCount: points.length,
    totalBytes: points.reduce((sum, point) => sum + point.totalBytes, 0),
    lastBackupAt: points[0]?.createdAtLocal ?? null,
    log,
    restoreProgram: {
      path: path.join(env.backupRoot, '恢复DSH.cmd'),
      script: path.join(env.backupRoot, 'restore.ps1'),
      guide: path.join(env.backupRoot, '使用说明.md'),
      ready: existsSync(path.join(env.backupRoot, '恢复DSH.cmd')) && existsSync(path.join(env.backupRoot, 'restore.ps1')),
      refreshed: program.written,
    },
    // Kept for diagnostics; the UI shows `restoreProgram.path`.
    schema: { format: POINT_FORMAT, version: POINT_VERSION },
  }
}

/**
 * Restore one point over the live DSH home.
 *
 * The current state is snapshotted first, so a restore is itself undoable. Files
 * are overwritten in place rather than moved aside: DSH keeps some session and
 * storage files open while it runs, and renaming their directories can fail
 * mid-flight.
 *
 * Sessions that a live agent still owns are left alone. DSH appends a running
 * session's log by event sequence, so replacing its file under the running
 * process would leave a gap between the restored tail and the next append and
 * make that session unreadable at the next start. Those sessions keep their
 * current state, are listed in `skippedLiveSessions`, and are restored by
 * running the restore again after a restart (or by the offline program).
 */
export async function restorePoint(env, id, { liveSessionIds = [] } = {}) {
  const manifest = await readManifest(env, id)
  if (manifest === undefined) throw new Error(`restore point not found: ${id}`)
  const dir = pointDirOf(env, id)
  const live = new Set(liveSessionIds.map((value) => String(value)))
  const skippedLive = new Set()
  const startedAt = Date.now()
  await appendLog(env, 'info', 'restore.start', { point: manifest.id, live: live.size })
  const safety = await createPoint(env, {
    note: `Auto snapshot before restoring ${manifest.id}`,
    noteKind: 'auto-before-restore',
    noteParam: manifest.id,
  })
  const results = []
  const home = path.resolve(env.home)
  for (const part of manifest.parts ?? []) {
    if (part.missing === true) continue
    const source = path.join(dir, part.id)
    if (!existsSync(source)) {
      results.push({ id: part.id, label: part.label, ok: false, error: 'backup part missing' })
      continue
    }
    const target = path.resolve(home, part.target)
    if (target !== home && !target.startsWith(`${home}${path.sep}`)) {
      results.push({ id: part.id, label: part.label, ok: false, error: 'refused target outside DSH home' })
      continue
    }
    const skip = part.id === 'sessions' && live.size > 0
      ? (sourcePath) => {
        if (path.basename(sourcePath) !== '' && live.has(path.basename(sourcePath))) {
          skippedLive.add(path.basename(sourcePath))
          return false
        }
        return true
      }
      : undefined
    try {
      await mkdir(path.dirname(target), { recursive: true })
      if (part.kind === 'file') {
        await cp(source, target, { force: true })
      } else {
        await cp(source, target, { recursive: true, force: true, ...(skip === undefined ? {} : { filter: skip }) })
      }
      results.push({ id: part.id, label: part.label, ok: true })
    } catch (error) {
      results.push({ id: part.id, label: part.label, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const failure of results.filter((result) => !result.ok)) {
    await appendLog(env, 'warn', 'restore.partFailed', {
      point: manifest.id,
      part: failure.id,
      error: String(failure.error ?? 'unknown'),
    })
  }
  const record = {
    restoredAt: new Date().toISOString(),
    point: { id: manifest.id, createdAt: manifest.createdAt, note: manifest.note ?? '' },
    safetyPoint: safety.id,
    ok: results.every((result) => result.ok),
    results,
    skippedLiveSessions: [...skippedLive],
    requiresRestart: true,
  }
  try {
    await mkdir(path.join(home, '.dsh-backup'), { recursive: true })
    await writeFile(path.join(home, '.dsh-backup', 'last-restore.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } catch {
    /* the restore itself already happened; the receipt is best effort */
  }
  await appendLog(env, record.ok ? 'info' : 'warn', 'restore.done', {
    point: manifest.id,
    ok: record.ok,
    safety: safety.id,
    failed: results.filter((result) => !result.ok).length,
    skipped: skippedLive.size,
    ms: Date.now() - startedAt,
  })
  return { ...record, backupRoot: env.backupRoot, safetyPointLocal: safety.createdAtLocal }
}

export async function deletePoint(env, id) {
  const dir = pointDirOf(env, id)
  if (!existsSync(dir)) throw new Error(`restore point not found: ${id}`)
  // Move first so an interrupted delete never leaves a half-restorable point.
  const graveyard = path.join(env.backupRoot, '.trash')
  await mkdir(graveyard, { recursive: true })
  const doomed = path.join(graveyard, `${id}-${stamp()}`)
  await rename(dir, doomed)
  await rm(doomed, { recursive: true, force: true })
  await appendLog(env, 'info', 'delete.done', { point: id })
  return { ok: true, id }
}

/** Reveal the backup folder (or its `logs` folder) in the OS file manager; a convenience, never a requirement. */
export async function openFolder(env, target = 'backup') {
  const logs = target === 'logs'
  const dir = logs ? path.join(env.backupRoot, 'logs') : env.backupRoot
  if (logs) await mkdir(dir, { recursive: true })
  const shown = logs || existsSync(dir) ? dir : env.workspace
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve) => {
    try {
      const child = spawn(command, [shown], { detached: true, stdio: 'ignore' })
      child.once('error', (error) => resolve({ ok: false, error: error.message }))
      child.once('spawn', () => {
        child.unref()
        resolve({ ok: true, path: shown })
      })
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
