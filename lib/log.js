/**
 * Minimal local operation log for the backup plugin.
 *
 * One line per event, written under `<workspace>/dsh-backups/logs/plugin.log`.
 * The folder is covered by the `.gitignore` the plugin writes into the backup
 * folder, so log lines cannot end up in a committed workspace by accident.
 *
 * Rules:
 * - never log credentials, session/attachment contents, or request bodies;
 * - logging failures never break the operation that is being logged;
 * - rotate at 512 KiB into one `.1` file, so support logs stay small.
 */

import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/** Rotation threshold per file. */
export const MAX_LOG_BYTES = 512 * 1024
/** Longest single field value kept in a line. */
const MAX_FIELD = 300
/** Serialize appends per file, so rotation and writes cannot interleave. */
const queues = new Map()

/** The log file for one resolved environment. */
export function logPath(env) {
  return path.join(env.backupRoot, 'logs', 'plugin.log')
}

/** Local ISO timestamp with a numeric offset, e.g. `2026-11-24T22:03:33+08:00`. */
function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const minutes = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** Collapse whitespace/newlines and cap one field, so a line stays one line. */
function clean(value) {
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD)
}

function formatFields(fields) {
  const entries = Object.entries(fields ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return entries.map(([key, value]) => {
    const text = clean(value)
    return /[\s="]/.test(text) ? `${key}=${JSON.stringify(text)}` : `${key}=${text}`
  }).join(' ')
}

/** One log line; exported for the tests and for anyone reading the format. */
export function formatLine(level, event, fields = {}) {
  const rest = formatFields(fields)
  return `${stamp()} ${String(level).toUpperCase()} ${clean(event)}${rest === '' ? '' : ` ${rest}`}`
}

async function rotateIfNeeded(file, maxBytes) {
  let size = 0
  try {
    size = (await stat(file)).size
  } catch {
    return
  }
  if (size < maxBytes) return
  const previous = `${file}.1`
  try {
    await rm(previous, { force: true })
    await rename(file, previous)
  } catch {
    /* a failed rotation keeps the current file growing; never fail the caller */
  }
}

/**
 * Append one event. Resolves after the line is written; never rejects.
 * @param env - resolved environment (`backupRoot`).
 * @param level - `info` | `warn` | `error`.
 * @param event - short event name such as `backup.done`.
 * @param fields - scalar details; values are cleaned and clipped.
 * @param options - `maxBytes` override (tests).
 */
export function appendLog(env, level, event, fields = {}, options = {}) {
  const file = logPath(env)
  const line = formatLine(level, event, fields)
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_LOG_BYTES
  const previous = queues.get(file) ?? Promise.resolve()
  const next = previous.then(async () => {
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await rotateIfNeeded(file, maxBytes)
      await appendFile(file, `${line}\n`, 'utf8')
    } catch {
      /* logging must never break a backup or a restore */
    }
  })
  queues.set(file, next.catch(() => {}))
  return next
}

/** Last `count` lines of the current log file, newest last. */
export async function tailLog(env, count = 15) {
  try {
    const text = await readFile(logPath(env), 'utf8')
    const lines = text.split(/\r?\n/).filter((line) => line !== '')
    return lines.slice(-Math.max(1, Number(count) || 15))
  } catch {
    return []
  }
}

/** Size and path of the current log, for diagnostics and the status payload. */
export async function logInfo(env) {
  const file = logPath(env)
  let size = 0
  try {
    size = (await stat(file)).size
  } catch {
    size = 0
  }
  return { path: file, size, maxBytes: MAX_LOG_BYTES }
}
