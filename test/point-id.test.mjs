import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createPoint,
  deletePoint,
  listPoints,
  restorePoint,
} from '../lib/engine.js'
import { createTool } from '../index.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-point-id-'))
try {
  await run(root)
} finally {
  await rm(root, { recursive: true, force: true })
}

async function run(root) {
  const home = path.join(root, 'home')
  const workspace = path.join(root, 'workspace')
  const backupRoot = path.join(workspace, 'dsh-backups')
  const pointsDir = path.join(backupRoot, 'points')
  process.env.DSH_HOME = home
  process.env.DSH_PROFILE = 'desktop'

  await mkdir(path.join(home, 'profiles/desktop'), { recursive: true })
  await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: 1\n')
  await mkdir(workspace, { recursive: true })

  const env = {
    home,
    profile: 'desktop',
    workspace,
    backupRoot,
    pointsDir,
    backupState: 'ready',
  }

  const check = (label, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || extra === '' ? '' : ` :: ${extra}`}`)
    if (!ok) process.exitCode = 1
  }

  async function rejects(promise, expected = '') {
    try {
      await promise
      return false
    } catch (error) {
      return expected === '' || String(error.message).includes(expected)
    }
  }

  // Normal generated IDs still work end-to-end.
  const first = await createPoint(env)
  check('normal ID has the expected shape', /^[A-Za-z0-9._-]+$/.test(first.id), first.id)
  check('normal ID can be listed', (await listPoints(env)).some((point) => point.id === first.id))
  await writeFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'version: 2\n')
  const restored = await restorePoint(env, first.id)
  check('normal ID can be restored', restored.ok === true)
  check('normal restore wrote the point contents', (await readFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'utf8')) === 'version: 1\n')
  check('normal ID can be deleted', (await deletePoint(env, first.id)).ok === true)
  check('normal deleted point is gone', (await listPoints(env)).every((point) => point.id !== first.id))

  const beforeIds = (await listPoints(env)).map((point) => point.id).sort()
  const beforeTrash = existsSync(path.join(backupRoot, '.trash'))
    ? readdirSync(path.join(backupRoot, '.trash')).length
    : 0

  // Every malformed ID must be rejected before touching the points directory.
  const invalidIds = [
    '', '.', '..', '../outside', '..\\outside', './outside', '.\\outside',
    'a/b', 'a\\b', '/absolute', 'C:\\Windows', 'C:foo',
    'foo/../bar', 'foo\\..\\bar', ' ', 'a\u0000b',
  ]
  for (const id of invalidIds) {
    const rejected = await rejects(deletePoint(env, id), 'invalid point id')
    check(`delete rejects ${JSON.stringify(id)}`, rejected)
  }

  const afterIds = (await listPoints(env)).map((point) => point.id).sort()
  const afterTrash = existsSync(path.join(backupRoot, '.trash'))
    ? readdirSync(path.join(backupRoot, '.trash')).length
    : 0
  check('invalid deletes leave every point intact', JSON.stringify(beforeIds) === JSON.stringify(afterIds))
  check('invalid deletes do not create trash entries', afterTrash === beforeTrash)

  let invalidRestoreRejected = false
  try {
    await restorePoint(env, '../outside')
  } catch (error) {
    invalidRestoreRejected = true
  }
  check('restore rejects an escaping ID', invalidRestoreRejected)
  check('invalid restore leaves the current profile untouched', (await readFile(path.join(home, 'profiles/desktop/cordis.patch.yml'), 'utf8')) === 'version: 1\n')

  // This manifest lives outside points/. If pointDirOf escaped, restore could read it.
  const outside = path.join(backupRoot, 'outside')
  await mkdir(outside, { recursive: true })
  await writeFile(path.join(outside, 'manifest.json'), JSON.stringify({
    format: 'dsh-desktop-restore-point',
    version: 1,
    id: 'outside',
    createdAt: new Date().toISOString(),
    createdAtLocal: '2026-11-26 15:00:00',
    parts: [],
  }, null, 2))
  await writeFile(path.join(outside, 'sentinel.txt'), 'outside data')
  check('escaping restore cannot read an outside manifest', await rejects(restorePoint(env, '../outside')))
  check('outside sentinel is unchanged', (await readFile(path.join(outside, 'sentinel.txt'), 'utf8')) === 'outside data')

  // The Agent tool must inherit the same engine-level validation.
  const tool = createTool({
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      if (name === 'workspaceRegistry') {
        return { list: () => [{ path: workspace, updatedAt: '2026-11-26T00:00:00.000Z' }] }
      }
      return undefined
    },
  })
  check('Agent delete rejects "."', await rejects(tool.execute({ action: 'delete', point: '.' }), 'invalid point id'))
  check('Agent restore rejects a traversal ID', await rejects(tool.execute({ action: 'restore', point: '../outside' })))
}
