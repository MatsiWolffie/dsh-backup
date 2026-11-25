/**
 * Host half of the backup bundle: the JSON route the plugin page calls and the
 * `dsh_backup` tool the agent calls. Both run the same engine functions, so a
 * backup or restore means exactly one thing.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  createPoint,
  deletePoint,
  ensureRestoreProgram,
  listStatus,
  openFolder,
  resolveEnvironment,
  restorePoint,
} from './lib/engine.js'
import { appendLog, logPath, tailLog } from './lib/log.js'

export const name = 'dsh-backup'

/** Mount diagnostics surfaced in the status payload; a stuck half still reports why. */
const diagnostics = { route: 'pending', routeError: '', tool: 'pending', toolError: '' }

const ROUTE = '/dsh-backup/api'
const MAX_BODY = 64 * 1024

function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

function authorityOf(host) {
  if (typeof host !== 'string' || host === '') return ''
  const value = host.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  const colon = value.lastIndexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
/** Every call from the plugin page carries this; a cross-origin page cannot add it without a preflight. */
const CALLER_HEADER = 'x-dsh-backup'

/**
 * The request fence for these routes: they are exact registrations outside the
 * Host's `/api` prefix, so the deployment's own request gate never sees them.
 *
 * - A cross-site marker is always refused, and a present Origin must name this
 *   same host (loopback spellings compare equal, because a proxy may rewrite one
 *   of them between `localhost` and `127.0.0.1`).
 * - Reads are otherwise open to local callers.
 * - Mutating calls must carry the plugin's own `x-dsh-backup` header, which a
 *   browser only sends to this origin; a hostile page's request would need a CORS
 *   preflight that this route never approves. This keeps the desktop shell's own
 *   fetch working even where it omits Origin or Sec-Fetch metadata.
 */
function admitted(req) {
  const site = typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : ''
  if (site === 'cross-site') return false
  const authority = authorityOf(req.headers.host)
  if (authority === '' || authority === 'null') return false
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  if (origin === 'null') return false
  if (origin !== '') {
    let originAuthority
    try {
      originAuthority = authorityOf(new URL(origin).host)
    } catch {
      return false
    }
    if (originAuthority === '' || originAuthority === 'null') return false
    const same = originAuthority === authority
      || (LOOPBACK.has(originAuthority) && LOOPBACK.has(authority))
    if (!same) return false
  }
  if (req.method === 'GET' || req.method === 'HEAD') return true
  if (req.headers[CALLER_HEADER] === '1') return true
  // Fallback for a page loaded before this header existed: the checks above have
  // already proven a present Origin names this host, and a browser without
  // Origin still reports its same-origin fetch metadata or a loopback Host.
  if (origin !== '') return true
  return site === 'same-origin' || site === 'same-site' || site === 'none' || LOOPBACK.has(authority)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const value = JSON.parse(text)
  return value !== null && typeof value === 'object' ? value : {}
}

function pointOf(body) {
  const point = typeof body.point === 'string' ? body.point.trim() : ''
  if (point === '') throw new Error('缺少还原点 (point)')
  return point
}

/** Session ids a live agent still owns; their logs must not be swapped under the running process. */
function liveSessionIds(ctx) {
  try {
    return (ctx.get('agents')?.list() ?? []).map((agent) => String(agent.id))
  } catch {
    return []
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace the user's home directory so a pasted report does not leak it. */
function redactPaths(text, env) {
  const home = String(env.home).replace(/[\\/]+$/, '')
  const userHome = homedir()
  return text
    .replace(new RegExp(escapeRegExp(home), 'gi'), '%USERPROFILE%\\.dsh')
    .replace(new RegExp(escapeRegExp(userHome), 'gi'), '%USERPROFILE%')
}

async function packageVersion() {
  try {
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
    return String(pkg.version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

async function dshVersion() {
  try {
    const dir = process.env.DSH_INSTALL_DIR
    if (!dir) return 'unknown'
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    return String(pkg.version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

/** Summary of the last restore receipt, or null when this machine never restored. */
async function lastRestoreSummary(env) {
  try {
    // Windows PowerShell writes the offline receipt with a UTF-8 BOM, and
    // ConvertTo-Json turns a one-element array into an object. Accept both.
    const text = (await readFile(path.join(env.home, '.dsh-backup', 'last-restore.json'), 'utf8')).replace(/^\uFEFF/, '')
    const receipt = JSON.parse(text)
    const results = Array.isArray(receipt.results)
      ? receipt.results
      : receipt.results === undefined || receipt.results === null ? [] : [receipt.results]
    const skipped = Array.isArray(receipt.skippedLiveSessions)
      ? receipt.skippedLiveSessions
      : receipt.skippedLiveSessions === undefined || receipt.skippedLiveSessions === null ? [] : [receipt.skippedLiveSessions]
    return {
      point: receipt.point?.id ?? 'unknown',
      ok: receipt.ok === true,
      safety: receipt.safetyPoint ?? '',
      failed: results.filter((result) => result.ok !== true).length,
      skipped: skipped.length,
      at: receipt.restoredAt ?? '',
    }
  } catch {
    return null
  }
}

/** Build the pasteable diagnostics block; paths are redacted and no contents are included. */
export async function buildDiagnostics(env) {
  const status = await listStatus(env)
  const log = status.log ?? { path: '', size: 0, maxBytes: 0 }
  const program = status.restoreProgram ?? { ready: false }
  const last = await lastRestoreSummary(env)
  const lines = log.path === '' ? [] : await tailLog(env, 12)
  const candidates = (status.backupCandidates ?? []).map((item) =>
    `  - ${item.backupRoot || item.workspace}${item.error === '' ? '' : ` (${item.error})`}`)
  const issues = (status.backupIssues ?? []).map((item) =>
    `  - ${item.workspace}${item.error === '' ? '' : ` (${item.error})`}`)
  const report = [
    'DSH 备份与恢复 · 诊断信息',
    `生成时间: ${new Date().toISOString()}`,
    `插件版本: ${await packageVersion()}`,
    `DSH 版本: ${await dshVersion()}`,
    `Profile: ${env.profile}`,
    `工作区: ${env.workspace}`,
    `备份位置来源: ${env.workspaceSource ?? 'unknown'}`,
    `备份状态: ${status.backupState ?? 'ready'}`,
    ...(status.backupError ? [`原因: ${status.backupError}`] : []),
    `备份目录: ${env.backupRoot}`,
    ...(candidates.length === 0 ? [] : ['备份目录候选:', ...candidates]),
    ...(issues.length === 0 ? [] : ['无法检查的工作区:', ...issues]),
    `日志文件: ${log.path} (${log.size} bytes, rotate at ${log.maxBytes})`,
    `挂载: route=${diagnostics.route}${diagnostics.routeError === '' ? '' : ` (${diagnostics.routeError})`} tool=${diagnostics.tool}${diagnostics.toolError === '' ? '' : ` (${diagnostics.toolError})`}`,
    `恢复程序: ready=${program.ready}`,
    `还原点: ${status.pointCount} 个；最近 ${status.lastBackupAt ?? '无'}`,
    last === null
      ? '上次恢复: 无记录'
      : `上次恢复: point=${last.point} ok=${last.ok} safety=${last.safety} failed=${last.failed} skipped=${last.skipped} at=${last.at}`,
    '要求: DSH >= 0.2.2-rc.5（engines.dsh）',
    '最近日志:',
    ...(lines.length === 0 ? ['  (空)'] : lines.map((line) => `  ${line}`)),
  ].join('\n')
  return redactPaths(report, env)
}

/** Run one named operation; every failure becomes `{ ok: false, error }`. */
async function runOperation(ctx, env, operation, point, options = {}) {
  if (operation !== 'status' && env.backupState !== undefined && env.backupState !== 'ready') {
    throw new Error(env.backupError || 'backup location is not ready')
  }
  switch (operation) {
    case 'status': {
      const status = await listStatus(env)
      return { ok: true, status }
    }
    case 'prepare': {
      await ensureRestoreProgram(env)
      const status = await listStatus(env)
      return { ok: true, status }
    }
    case 'backup': {
      const manifest = await createPoint(env, { includeCredentials: options.includeCredentials === true })
      const status = await listStatus(env)
      return { ok: true, point: manifest, status }
    }
    case 'restore': {
      const restored = await restorePoint(env, point, { liveSessionIds: liveSessionIds(ctx) })
      const status = await listStatus(env)
      return { ok: true, restore: restored, status }
    }
    case 'delete': {
      const deleted = await deletePoint(env, point)
      const status = await listStatus(env)
      return { ok: true, deleted, status }
    }
    case 'open': {
      const opened = await openFolder(env, options.target === 'logs' ? 'logs' : 'backup')
      return { ok: true, open: opened }
    }
    default:
      throw new Error(`unknown operation: ${operation}`)
  }
}

/**
 * The model-facing tool. It exposes the same engine operations the page uses and
 * reports failures as thrown errors so the tool result carries the reason.
 * @param ctx - the plugin context, used to list live sessions at restore time.
 * @returns the tool definition to register.
 */
export function createTool(ctx) {
  const pointsOf = (status) => status.points.map((point) => ({
    id: point.id,
    createdAtLocal: point.createdAtLocal,
    note: point.note,
    totalBytes: point.totalBytes,
  }))
  return {
    name: 'dsh_backup',
    description:
      'Create, list, restore, or delete DSH desktop restore points. A restore point is a folder in the '
      + "workspace's dsh-backups directory holding the profile configuration, session logs, local storages, "
      + 'and attachments, plus the local sign-in records only when explicitly requested. `backup` writes a new '
      + 'point; `status` lists points; `restore` overwrites the live DSH home with a point (it snapshots the '
      + 'current state first, keeps the sessions DSH still has open, and needs a DSH restart to take effect); '
      + '`delete` removes one point. Use `status` first and pass the exact point id.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'backup', 'restore', 'delete'],
        description: 'status lists points; backup creates one; restore and delete need `point`.',
      },
      point: {
        type: 'string',
        description: 'The restore point id from `status`, such as `20261123-221843`.',
      },
      includeCredentials: {
        type: 'boolean',
        description: 'For `backup`: also copy the local sign-in records (.credentials.yaml) in plain text. Off by default; only enable when the restore must include the signed-in account.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'message'],
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          backupRoot: { type: 'string' },
          points: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'createdAtLocal'],
              properties: {
                id: { type: 'string' },
                createdAtLocal: { type: 'string' },
                note: { type: 'string' },
                totalBytes: { type: 'integer' },
              },
            },
          },
          point: { type: 'string' },
          safetyPoint: { type: 'string' },
          requiresRestart: { type: 'boolean' },
          failedParts: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.message ?? 'dsh_backup finished') }],
    },
    execute: async (args) => {
      const action = typeof args?.action === 'string' ? args.action : ''
      try {
        if (!['status', 'backup', 'restore', 'delete'].includes(action)) {
          throw new Error(`unknown action: ${action === '' ? '(missing)' : action}`)
        }
        const env = resolveEnvironment(ctx)
        if (action === 'status') {
          const status = await listStatus(env)
          if (status.backupState !== 'ready') {
            return {
              ok: false,
              message: status.backupError || 'backup location is not ready; scan again after fixing the workspace folders',
              backupRoot: '',
              points: [],
            }
          }
          return {
            ok: true,
            message: status.pointCount === 0
              ? `No restore points yet. Backups live in ${status.backupRoot}.`
              : `${status.pointCount} restore point(s) in ${status.backupRoot}.`,
            backupRoot: status.backupRoot,
            points: pointsOf(status),
          }
        }
        if (env.backupState !== undefined && env.backupState !== 'ready') {
          throw new Error(env.backupError || 'backup location is not ready')
        }
        if (action === 'backup') {
          const manifest = await createPoint(env, { includeCredentials: args?.includeCredentials === true })
          const status = await listStatus(env)
          return {
            ok: true,
            message: `Created restore point ${manifest.id} (${manifest.fileCount} files, ${manifest.totalBytes} bytes).`,
            backupRoot: status.backupRoot,
            point: manifest.id,
            points: pointsOf(status),
          }
        }
        const point = typeof args?.point === 'string' ? args.point.trim() : ''
        if (point === '') throw new Error('`point` is required for this action')
        if (action === 'delete') {
          await deletePoint(env, point)
          const status = await listStatus(env)
          return { ok: true, message: `Deleted restore point ${point}.`, backupRoot: status.backupRoot, point }
        }
        if (action === 'restore') {
          const restored = await restorePoint(env, point, { liveSessionIds: liveSessionIds(ctx) })
          const failedParts = restored.results.filter((result) => !result.ok).map((result) => result.id)
          const kept = restored.skippedLiveSessions.length
          return {
            ok: restored.ok,
            message: restored.ok
              ? `Restored ${point}. Restart DSH for the restored configuration and sessions to take effect. A safety backup was written as ${restored.safetyPoint}.`
                + (kept === 0 ? '' : ` ${kept} session(s) that DSH still has open were kept as they are; restore again after the restart to include them.`)
              : `Restored ${point} with failures in: ${failedParts.join(', ')}. Close DSH and use the offline restore program in ${restored.backupRoot} to finish.`,
            backupRoot: restored.backupRoot,
            point,
            safetyPoint: restored.safetyPoint,
            requiresRestart: true,
            failedParts,
          }
        }
        throw new Error(`unknown action: ${action}`)
      } catch (error) {
        try {
          await appendLog(resolveEnvironment(ctx), 'error', 'tool.failed', {
            action: action === '' ? '(missing)' : action,
            error: error instanceof Error ? error.message : String(error),
          })
        } catch {
          /* logging must not hide the original failure */
        }
        throw error
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `DSH backup: ${typeof args?.action === 'string' ? args.action : 'status'}`,
      kind: 'other',
      rawInput: args,
    }),
  }
}

export function apply(ctx) {
  // The page needs the web server; the tool needs the tool registry. Either may
  // be absent in a headless composition, so each half mounts independently.
  ctx.inject(['webServer'], (web) => {
    const server = web.webServer ?? web.get('webServer')
    if (server === undefined) {
      diagnostics.route = 'service-missing'
      return
    }
    try {
      web.effect(
        () => server.register({
          kind: 'prefix',
          path: ROUTE,
          handler: async (req, res) => {
            try {
              const env = resolveEnvironment(ctx)
              if (!admitted(req)) {
                await appendLog(env, 'warn', 'http.forbidden', {
                  host: authorityOf(req.headers.host) || '(none)',
                  site: req.headers['sec-fetch-site'] ?? '',
                })
                send(res, 403, {
                  ok: false,
                  error: 'forbidden',
                  detail: `host=${req.headers.host ?? ''} origin=${req.headers.origin ?? ''} site=${req.headers['sec-fetch-site'] ?? ''}`,
                })
                return
              }
              const url = new URL(req.url ?? ROUTE, 'http://localhost')
              const operation = url.pathname.startsWith(`${ROUTE}/`) ? url.pathname.slice(ROUTE.length + 1) : ''
              if (req.method === 'GET' || req.method === 'HEAD') {
                if (operation === 'status') {
                  send(res, 200, { ...await listStatus(env), diagnostics })
                  return
                }
                if (operation === 'diagnostics') {
                  send(res, 200, { ok: true, report: await buildDiagnostics(env), logPath: env.backupRoot === '' ? '' : logPath(env) })
                  return
                }
                send(res, 405, { ok: false, error: 'method not allowed' })
                return
              }
              if (req.method !== 'POST') {
                send(res, 405, { ok: false, error: 'method not allowed' })
                return
              }
              const body = await readJson(req)
              const point = operation === 'restore' || operation === 'delete' ? pointOf(body) : ''
              let result
              try {
                result = await runOperation(ctx, env, operation, point, {
                  includeCredentials: body.includeCredentials === true,
                  target: typeof body.target === 'string' ? body.target : '',
                })
              } catch (error) {
                send(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
                return
              }
              send(res, 200, result)
            } catch (error) {
              try {
                await appendLog(resolveEnvironment(ctx), 'error', 'http.failed', {
                  error: error instanceof Error ? error.message : String(error),
                })
              } catch {
                /* ignore */
              }
              send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        'dsh-backup: api route',
      )
      diagnostics.route = 'registered'
    } catch (error) {
      diagnostics.route = 'failed'
      diagnostics.routeError = error instanceof Error ? error.message : String(error)
    }
  })

  ctx.inject(['tools'], (tools) => {
    const registry = tools.tools ?? tools.get('tools')
    if (registry === undefined) {
      diagnostics.tool = 'service-missing'
      return
    }
    try {
      tools.effect(() => registry.register(createTool(ctx)), 'dsh-backup: tool')
      diagnostics.tool = 'registered'
    } catch (error) {
      diagnostics.tool = 'failed'
      diagnostics.toolError = error instanceof Error ? error.message : String(error)
    }
  })
}
