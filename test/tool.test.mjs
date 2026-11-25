import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTool } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '.tmp-tool')
await rm(root, { recursive: true, force: true })
const home = path.join(root, 'dsh-home')
const workspace = path.join(root, 'workspace')
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'desktop'

await mkdir(path.join(home, 'profiles/desktop'), { recursive: true })
await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: original\n')
await mkdir(path.join(home, 'sessions/s1'), { recursive: true })
await writeFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'original')
await writeFile(path.join(home, '.credentials.yaml'), 'version: original\n')
await mkdir(workspace, { recursive: true })

const ctx = {
  get: (name) => {
    if (name === 'workingDirectory') return { defaultDirectory: workspace }
    if (name === 'workspaceRegistry') {
      return { list: () => [{ path: workspace, updatedAt: '2026-01-01T00:00:00.000Z' }] }
    }
    if (name === 'agents') return { list: () => [{ id: 's1' }] }
    return undefined
  },
}
const tool = createTool(ctx)
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === '' ? '' : ` :: ${extra}`}`)
  if (!ok) process.exitCode = 1
}

const status = await tool.execute({ action: 'status' })
check('status reports no points', status.ok === true && status.points.length === 0, JSON.stringify(status))
check('status names the backup folder', status.backupRoot === path.join(workspace, 'dsh-backups'), status.backupRoot)

const backup = await tool.execute({ action: 'backup' })
check('backup creates a point', typeof backup.point === 'string' && backup.point.length > 0)
check('backup lists the new point', backup.points.length === 1)
check('backup message mentions files', /Created restore point/.test(backup.message), backup.message)

await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: changed\n')
await writeFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'changed')
const restore = await tool.execute({ action: 'restore', point: backup.point })
check('restore ok', restore.ok === true, restore.message)
check('restore keeps live session', (await readFile(path.join(home, 'sessions/s1/session.v4.jsonl.zstd'), 'utf8')) === 'changed')
check('restore restores config', (await readFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'utf8')) === 'version: original\n')
check('restore reports restart', restore.requiresRestart === true)
check('restore reports safety point', typeof restore.safetyPoint === 'string' && restore.safetyPoint.length > 0)
check('restore message mentions kept sessions', /kept as they are/.test(restore.message), restore.message)

const after = await tool.execute({ action: 'status' })
check('status shows safety point too', after.points.length === 2, JSON.stringify(after.points.map((p) => p.id)))

const deleted = await tool.execute({ action: 'delete', point: backup.point })
check('delete ok', deleted.ok === true, deleted.message)

let missing = false
try {
  await tool.execute({ action: 'restore' })
} catch (error) {
  missing = /point/.test(error.message)
}
check('missing point rejected', missing)

let unknown = false
try {
  await tool.execute({ action: 'explode' })
} catch (error) {
  unknown = /unknown action/.test(error.message)
}
check('unknown action rejected', unknown)

const rendered = tool.output.render({}, { message: 'hello' })
check('render produces text', rendered.length === 1 && rendered[0].type === 'text' && rendered[0].text === 'hello')

await rm(root, { recursive: true, force: true })
