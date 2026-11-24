/**
 * Client half of the backup bundle: the "备份与还原点" card on this bundle's
 * page under Plugins. It reads and mutates through the Host route
 * `/dsh-backup/api`, so the page and the `dsh_backup` tool share one engine.
 */

window.__ModuleLoader__.load({
  id: '@matsiwolffie/dsh-backup',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const NS = 'dsh-backup'
    const API = '/dsh-backup/api'

    const en = {
      title: 'Back up and restore',
      intro: 'Save this DSH desktop’s configuration, sessions, local storage, and attachments as restore points in a folder inside the workspace. Sign-in records are opt-in.',
      backupNow: 'Back up now',
      backingUp: 'Backing up…',
      backupDone: 'Restore point {point} created.',
      location: 'Backup folder',
      copyPath: 'Copy path',
      copied: 'Copied',
      openFolder: 'Open folder',
      pointsHeading: 'Restore points',
      pointCount: '{n} restore point(s)',
      totalSize: '{size} in total',
      lastBackup: 'Last backup: {time}',
      never: 'never',
      emptyTitle: 'No restore points yet',
      emptyHint: 'Select “Back up now” to write the first restore point.',
      restore: 'Restore',
      delete: 'Delete',
      restoreConfirmTitle: 'Restore {time}?',
      restoreConfirmBody: 'This overwrites the current DSH configuration, sessions, storage, and attachments. The current state is saved as a safety restore point first. Sessions DSH still has open are kept as they are and are restored by running the restore again after the restart.',
      deleteConfirmTitle: 'Delete {time}?',
      deleteConfirmBody: 'The restore point folder is removed from the workspace. This cannot be undone.',
      confirmRestore: 'Restore this point',
      confirmDelete: 'Delete this point',
      cancel: 'Cancel',
      restoring: 'Restoring…',
      deleting: 'Deleting…',
      restoreDone: 'Restored {point}. Quit DSH completely and open it again to apply the restore.',
      restoreLiveKept: '{n} session(s) that DSH still has open were kept as they are; restore again after the restart to include them.',
      restorePartial: 'Restored {point}, but these parts failed: {parts}. Close DSH and use the offline restore program to finish.',
      deleted: 'Deleted restore point {point}.',
      offlineTitle: 'When DSH cannot start',
      offlineHint: 'Double-click “恢复DSH.cmd” in the backup folder, pick a restore point, and the program overwrites the DSH data while DSH is closed. File: {path}',
      offlineMissing: 'The offline restore program is missing from the backup folder. Select “Repair” to write it again.',
      repair: 'Repair',
      repairing: 'Repairing…',
      includeCredentials: 'Include sign-in records',
      credentialsTag: 'includes credentials',
      diagnosticsTitle: 'Diagnostics',
      diagnosticsHint: 'Operation log for troubleshooting. The copied report shortens the home folder to %USERPROFILE%; the log file itself keeps full paths.',
      copyDiagnostics: 'Copy diagnostics',
      copying: 'Copying…',
      openLogs: 'Open log folder',
      diagnosticsCopied: 'Diagnostics copied. Check it before sharing.',
      clipboardUnavailable: 'Could not copy automatically; use “Open log folder” instead.',
      logFile: 'Log file',
      credentialNote: 'Sign-in records are not backed up by default. When enabled, a restore point holds .credentials.yaml in plain text, so never share or commit the backup folder. Sessions and attachments are private too.',
      filesLabel: '{n} file(s) · {size}',
      loading: 'Reading backup status…',
      hostUnavailable: 'The backup service did not answer (HTTP {status}). Make sure “Back up and restore” is enabled on the Plugins page and refresh this page; if you just updated the plugin, restart DSH and retry.',
      loadFailed: 'Could not read the backup status: {error}',
      retry: 'Retry',
      actionFailed: 'Operation failed: {error}',
      safetyNote: 'A safety restore point {point} was written before restoring.',
      autoSnapshotTag: 'Auto snapshot before restore {point}',
      listSeparator: ', ',
    }

    const zh = {
      title: '备份与恢复',
      intro: '把本机 DSH 桌面端的配置、会话、本机存储与附件保存为还原点，统一放在工作区内的 dsh-backups 文件夹；登录凭据需勾选后才备份。',
      backupNow: '立即备份',
      backingUp: '正在备份…',
      backupDone: '已创建还原点 {point}。',
      location: '备份位置',
      copyPath: '复制路径',
      copied: '已复制',
      openFolder: '打开文件夹',
      pointsHeading: '还原点',
      pointCount: '共 {n} 个还原点',
      totalSize: '合计 {size}',
      lastBackup: '最近备份：{time}',
      never: '暂无',
      emptyTitle: '还没有还原点',
      emptyHint: '点击“立即备份”创建第一个还原点。',
      restore: '恢复',
      delete: '删除',
      restoreConfirmTitle: '恢复到 {time} 的还原点？',
      restoreConfirmBody: '将覆盖当前的 DSH 配置、会话、本机存储与附件。恢复前会先自动保存一份当前状态的还原点。DSH 当前打开的会话保持不变，重启 DSH 后再恢复一次即可连同它们一起还原。',
      deleteConfirmTitle: '删除 {time} 的还原点？',
      deleteConfirmBody: '该还原点文件夹会从工作区中删除，此操作无法撤销。',
      confirmRestore: '确认恢复',
      confirmDelete: '确认删除',
      cancel: '取消',
      restoring: '正在恢复…',
      deleting: '正在删除…',
      restoreDone: '已恢复还原点 {point}。请完全退出 DSH 后重新打开，使还原生效。',
      restoreLiveKept: '当前打开的 {n} 个会话保持不变；重启 DSH 后再执行一次恢复即可连同它们一起还原。',
      restorePartial: '已恢复 {point}，但这些部分未能覆盖：{parts}。请关闭 DSH 后使用离线恢复程序完成。',
      deleted: '已删除还原点 {point}。',
      offlineTitle: 'DSH 无法启动时',
      offlineHint: '双击备份文件夹里的“恢复DSH.cmd”，按提示选择还原点，程序会在 DSH 关闭状态下覆盖恢复。文件：{path}',
      offlineMissing: '备份文件夹里缺少离线恢复程序，点击“修复”重新生成。',
      repair: '修复',
      repairing: '正在生成…',
      includeCredentials: '同时备份登录凭据',
      credentialsTag: '含凭据',
      diagnosticsTitle: '诊断',
      diagnosticsHint: '排查问题用的操作日志。复制出的诊断信息会把主目录显示为 %USERPROFILE%；日志文件本身保留完整路径。',
      copyDiagnostics: '复制诊断信息',
      copying: '正在复制…',
      openLogs: '打开日志文件夹',
      diagnosticsCopied: '诊断信息已复制，分享前请检查内容。',
      clipboardUnavailable: '无法自动复制，请改用“打开日志文件夹”。',
      logFile: '日志文件',
      credentialNote: '默认不备份登录凭据；勾选后还原点会包含明文的 .credentials.yaml，请勿分享或提交备份文件夹。会话与附件同样是私有数据。',
      filesLabel: '{n} 个文件 · {size}',
      loading: '正在读取备份状态…',
      hostUnavailable: '备份服务未响应（HTTP {status}）。请确认「备份与恢复」在插件页已启用并刷新页面；如果刚更新过插件，请重启 DSH 后再试。',
      loadFailed: '读取备份状态失败：{error}',
      retry: '重试',
      actionFailed: '操作失败：{error}',
      safetyNote: '恢复前已自动保存还原点 {point}。',
      autoSnapshotTag: '自动快照：恢复 {point} 前',
      listSeparator: '、',
    }

    const CSS = `
.dsb-card { display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dsb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dsb-heading { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 320px; }
.dsb-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; }
.dsb-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dsb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsb-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap; }
.dsb-check input { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.dsb-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; height: 28px; padding: 0 10px; border-radius: var(--dsw-radius-sm, 6px); border: .5px solid transparent;
  box-shadow: inset 0 0 0 var(--dsh-hairline-width, .5px) var(--dsw-alias-border-l3);
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px;
  line-height: 18px; cursor: pointer; white-space: nowrap;
  transition: background-color var(--ds-transition-duration, .15s) ease, color var(--ds-transition-duration, .15s) ease; }
.dsb-btn:disabled { opacity: .5; cursor: default; }
.dsb-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsb-primary { box-shadow: none; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));
  color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsb-danger { box-shadow: inset 0 0 0 var(--dsh-hairline-width, .5px)
  color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l3));
  color: var(--dsw-alias-state-error-primary); }
.dsb-ghost { border-color: transparent; color: var(--dsw-alias-label-secondary); }
@media (hover: hover) {
  .dsb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
  .dsb-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary)); }
  .dsb-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
  .dsb-ghost:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
}
.dsb-meta { display: flex; flex-direction: column; gap: 4px; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; }
.dsb-path-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsb-path { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; font-size: 12px; }
.dsb-linkbtn { border: 0; background: transparent; padding: 0; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-brand-primary); text-decoration: underline; text-underline-offset: 2px; }
.dsb-linkbtn:disabled { opacity: .5; cursor: default; }
.dsb-notice { margin: 0; border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 18px;
  border: .5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2); overflow-wrap: anywhere; }
.dsb-notice-ok { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-border-l2)); }
.dsb-notice-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2)); }
.dsb-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dsb-section-title { margin: 0; font-size: 13px; font-weight: 600; }
.dsb-count { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsb-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dsb-point { display: flex; flex-direction: column; gap: 10px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); padding: 10px 12px; background: var(--dsw-alias-bg-layer-1); }
.dsb-point-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dsb-point-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsb-point-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsb-point-time { font-size: 13px; font-weight: 600; }
.dsb-point-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.dsb-tag { border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 0 8px;
  font-size: 11px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsb-tag-warn { color: var(--dsw-alias-state-warn-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l2)); }
.dsb-point-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsb-confirm { display: flex; flex-direction: column; gap: 8px; border: .5px solid
  var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); }
.dsb-confirm-title { margin: 0; font-size: 13px; font-weight: 600; }
.dsb-confirm-body { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsb-confirm-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsb-empty { border: .5px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); padding: 18px 12px;
  text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dsb-empty strong { display: block; color: var(--dsw-alias-label-primary); font-size: 13px; margin-bottom: 4px; }
.dsb-offline { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsb-offline strong { color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsb-offline code { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsb-diag { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsb-diag strong { color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsb-foot { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
`

    function message(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function bytes(value) {
      const size = Number(value) || 0
      if (size < 1024) return `${size} B`
      const units = ['KB', 'MB', 'GB']
      let scaled = size / 1024
      let unit = 0
      while (scaled >= 1024 && unit < units.length - 1) {
        scaled /= 1024
        unit += 1
      }
      return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`
    }

    async function call(operation, body) {
      const init = body === undefined
        ? { credentials: 'same-origin', headers: { 'x-dsh-backup': '1' } }
        : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-dsh-backup': '1' },
          body: JSON.stringify(body),
        }
      let response
      try {
        response = await fetch(`${API}/${operation}`, init)
      } catch (error) {
        const failure = new Error(message(error))
        failure.status = 0
        throw failure
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok) {
        const failure = new Error(payload?.error ?? `HTTP ${response.status}`)
        failure.status = response.status
        failure.detail = payload?.detail
        throw failure
      }
      if (payload === undefined) throw new Error('empty response')
      if (payload.ok === false) throw new Error(payload.error ?? 'request failed')
      return payload
    }

    /**
     * How a failed call reads in the card. A 403/404/405 means the Host route is
     * not mounted in this process — the usual cause is the bundle being switched
     * off on the Plugins page, which leaves this card rendered (it comes from the
     * installed client module) while every call falls through to the static
     * handler. Say that, instead of showing a bare "forbidden".
     */
    function callFailure(t, error) {
      const status = typeof error?.status === 'number' ? error.status : -1
      if (status === 0 || status === 403 || status === 404 || status === 405) {
        return t('hostUnavailable', { status: status === 0 ? 'network' : String(status) })
      }
      return ''
    }

    function BackupCard(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [state, setState] = useState({ status: 'loading' })
      const [busy, setBusy] = useState('')
      const [confirm, setConfirm] = useState(null)
      const [notice, setNotice] = useState(null)
      const [copied, setCopied] = useState(false)
      const [includeCredentials, setIncludeCredentials] = useState(false)

      const load = useCallback(async () => {
        try {
          const payload = await call('status')
          setState({ status: 'ready', data: payload })
        } catch (error) {
          setState({ status: 'error', error })
        }
      }, [])

      useEffect(() => {
        let live = true
        call('status').then(
          (payload) => { if (live) setState({ status: 'ready', data: payload }) },
          (error) => { if (live) setState({ status: 'error', error }) },
        )
        return () => { live = false }
      }, [])

      useEffect(() => {
        if (copied !== true) return undefined
        const timer = setTimeout(() => { setCopied(false) }, 2000)
        return () => { clearTimeout(timer) }
      }, [copied])

      const run = useCallback(async (operation, body, onDone) => {
        setBusy(operation)
        setNotice(null)
        try {
          const payload = await call(operation, body ?? {})
          if (payload.status !== undefined) setState({ status: 'ready', data: payload.status })
          setConfirm(null)
          setNotice(onDone(payload))
        } catch (error) {
          const friendly = callFailure(t, error)
          setNotice({ kind: 'error', text: friendly !== '' ? friendly : t('actionFailed', { error: message(error) }) })
        } finally {
          setBusy('')
        }
      }, [load, t])

      const ready = state.status === 'ready' ? state.data : undefined
      const points = ready?.points ?? []
      const busyAny = busy !== ''

      const copyPath = () => {
        const text = ready?.backupRoot ?? ''
        if (text === '') return
        if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
          setNotice({ kind: 'error', text: text })
          return
        }
        navigator.clipboard.writeText(text).then(
          () => { setCopied(true) },
          () => { setNotice({ kind: 'plain', text }) },
        )
      }

      const copyDiagnostics = async () => {
        setBusy('diag')
        setNotice(null)
        try {
          const payload = await call('diagnostics')
          if (typeof payload.report !== 'string' || payload.report === '') throw new Error('empty diagnostics')
          if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
            setNotice({ kind: 'plain', text: t('clipboardUnavailable') })
            return
          }
          await navigator.clipboard.writeText(payload.report)
          setNotice({ kind: 'ok', text: t('diagnosticsCopied') })
        } catch (error) {
          const friendly = callFailure(t, error)
          setNotice({ kind: 'error', text: friendly !== '' ? friendly : t('actionFailed', { error: message(error) }) })
        } finally {
          setBusy('')
        }
      }

      const header = h('div', { className: 'dsb-head' },
        h('div', { className: 'dsb-heading' },
          h('h4', { className: 'dsb-title' }, t('title')),
          h('p', { className: 'dsb-intro' }, t('intro')),
        ),
        h('div', { className: 'dsb-actions' },
          h('label', { className: 'dsb-check' },
            h('input', {
              type: 'checkbox',
              checked: includeCredentials,
              disabled: busyAny,
              onChange: (event) => { setIncludeCredentials(event.target.checked === true) },
            }),
            h('span', null, t('includeCredentials')),
          ),
          h('button', {
            type: 'button',
            className: 'dsb-btn dsb-primary',
            disabled: busyAny,
            'aria-busy': busy === 'backup' ? 'true' : undefined,
            onClick: () => { run('backup', { includeCredentials }, (payload) => ({ kind: 'ok', text: t('backupDone', { point: payload.point?.createdAtLocal ?? payload.point?.id ?? '' }) })) },
          }, busy === 'backup' ? t('backingUp') : t('backupNow')),
        ),
      )

      let meta = null
      if (state.status === 'loading') {
        meta = h('p', { className: 'dsb-meta' }, t('loading'))
      } else if (state.status === 'error') {
        const friendly = callFailure(t, state.error)
        meta = h('div', { className: 'dsb-notice dsb-notice-error' },
          h('span', null, friendly !== '' ? friendly : t('loadFailed', { error: message(state.error) })),
          ' ',
          h('button', { type: 'button', className: 'dsb-linkbtn', onClick: () => { load() } }, t('retry')),
        )
      } else if (ready !== undefined) {
        meta = h('div', { className: 'dsb-meta' },
          h('div', { className: 'dsb-path-row' },
            h('span', null, `${t('location')}:`),
            h('code', { className: 'dsb-path' }, ready.backupRoot),
            h('button', { type: 'button', className: 'dsb-linkbtn', disabled: busyAny, onClick: copyPath },
              copied ? t('copied') : t('copyPath')),
            h('button', {
              type: 'button',
              className: 'dsb-linkbtn',
              disabled: busyAny,
              onClick: () => {
                run('open', {}, (payload) => payload.open?.ok === false
                  ? { kind: 'error', text: t('actionFailed', { error: payload.open.error ?? '' }) }
                  : null)
              },
            }, t('openFolder')),
          ),
        )
      }

      let noticeNode = null
      if (notice !== null) {
        noticeNode = h('p', {
          className: `dsb-notice ${notice.kind === 'ok' ? 'dsb-notice-ok' : notice.kind === 'error' ? 'dsb-notice-error' : ''}`,
          role: notice.kind === 'error' ? 'alert' : 'status',
        }, notice.text)
      }

      let list
      if (points.length === 0) {
        list = h('div', { className: 'dsb-empty' },
          h('strong', null, t('emptyTitle')),
          h('span', null, t('emptyHint')),
        )
      } else {
        list = h('ul', { className: 'dsb-list' }, points.map((point) => {
          const open = confirm !== null && confirm.id === point.id
          // The manifest carries the structured kind; the English note is the
          // fallback so points written before that field existed stay localized.
          const legacyAuto = /^Auto snapshot before restoring (.+)$/.exec(point.note ?? '')
          const autoPoint = point.noteKind === 'auto-before-restore'
            ? point.noteParam
            : legacyAuto === null ? '' : legacyAuto[1]
          const row = h('div', { className: 'dsb-point-row' },
            h('div', { className: 'dsb-point-main' },
              h('div', { className: 'dsb-point-title' },
                h('span', { className: 'dsb-point-time' }, point.createdAtLocal),
                autoPoint !== ''
                  ? h('span', { className: 'dsb-tag' }, t('autoSnapshotTag', { point: autoPoint }))
                  : point.note === '' ? null : h('span', { className: 'dsb-tag' }, point.note),
                point.includesCredentials === true
                  ? h('span', { className: 'dsb-tag dsb-tag-warn' }, t('credentialsTag'))
                  : null,
              ),
              h('span', { className: 'dsb-point-sub' },
                t('filesLabel', { n: point.fileCount, size: bytes(point.totalBytes) })),
            ),
            open
              ? null
              : h('div', { className: 'dsb-point-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsb-btn',
                  disabled: busyAny,
                  onClick: () => { setNotice(null); setConfirm({ kind: 'restore', id: point.id }) },
                }, t('restore')),
                h('button', {
                  type: 'button',
                  className: 'dsb-btn dsb-ghost',
                  disabled: busyAny,
                  onClick: () => { setNotice(null); setConfirm({ kind: 'delete', id: point.id }) },
                }, t('delete')),
              ),
          )
          const confirmation = open
            ? h('div', { className: 'dsb-confirm' },
              h('p', { className: 'dsb-confirm-title' },
                t(confirm.kind === 'restore' ? 'restoreConfirmTitle' : 'deleteConfirmTitle', { time: point.createdAtLocal })),
              h('p', { className: 'dsb-confirm-body' },
                t(confirm.kind === 'restore' ? 'restoreConfirmBody' : 'deleteConfirmBody')),
              h('div', { className: 'dsb-confirm-actions' },
                h('button', {
                  type: 'button',
                  className: confirm.kind === 'restore' ? 'dsb-btn dsb-primary' : 'dsb-btn dsb-danger',
                  disabled: busyAny,
                  onClick: () => {
                    if (confirm.kind === 'restore') {
                      run('restore', { point: point.id }, (payload) => {
                        const restored = payload.restore ?? {}
                        if (restored.ok === false) {
                          const failed = (restored.results ?? []).filter((item) => item.ok === false).map((item) => item.label ?? item.id)
                          return { kind: 'error', text: t('restorePartial', { point: point.createdAtLocal, parts: failed.join(t('listSeparator')) }) }
                        }
                        return { kind: 'ok', text: t('restoreDone', { point: point.createdAtLocal }) + ' ' + t('safetyNote', { point: restored.safetyPointLocal ?? '' }) + (restored.skippedLiveSessions?.length > 0 ? ' ' + t('restoreLiveKept', { n: restored.skippedLiveSessions.length }) : '') }
                      })
                    } else {
                      run('delete', { point: point.id }, () => ({ kind: 'ok', text: t('deleted', { point: point.createdAtLocal }) }))
                    }
                  },
                }, busy === 'restore' ? t('restoring') : busy === 'delete' ? t('deleting') : confirm.kind === 'restore' ? t('confirmRestore') : t('confirmDelete')),
                h('button', {
                  type: 'button',
                  className: 'dsb-btn dsb-ghost',
                  disabled: busyAny,
                  onClick: () => { setConfirm(null) },
                }, t('cancel')),
              ),
            )
            : null
          return h('li', { key: point.id, className: 'dsb-point' }, row, confirmation)
        }))
      }

      let offline
      if (ready === undefined) {
        offline = null
      } else if (ready.restoreProgram?.ready === true) {
        offline = h('div', { className: 'dsb-offline' },
          h('strong', null, t('offlineTitle')),
          h('span', null, t('offlineHint', { path: ready.restoreProgram.path })),
          h('span', null, t('credentialNote')),
        )
      } else {
        offline = h('div', { className: 'dsb-offline' },
          h('strong', null, t('offlineTitle')),
          h('span', null, t('offlineMissing')),
          h('button', {
            type: 'button',
            className: 'dsb-btn',
            disabled: busyAny,
            onClick: () => { run('prepare', {}, (payload) => ({ kind: 'ok', text: t('offlineHint', { path: payload.status?.restoreProgram?.path ?? ready.restoreProgram.path }) })) },
          }, busy === 'prepare' ? t('repairing') : t('repair')),
        )
      }

      let diagnosticsBlock = null
      if (ready !== undefined && ready.log?.path) {
        diagnosticsBlock = h('div', { className: 'dsb-diag' },
          h('strong', null, t('diagnosticsTitle')),
          h('span', null, t('diagnosticsHint')),
          h('div', { className: 'dsb-path-row' },
            h('code', { className: 'dsb-path' }, ready.log?.path ?? ''),
            h('button', {
              type: 'button',
              className: 'dsb-linkbtn',
              disabled: busyAny,
              onClick: copyDiagnostics,
            }, busy === 'diag' ? t('copying') : t('copyDiagnostics')),
            h('button', {
              type: 'button',
              className: 'dsb-linkbtn',
              disabled: busyAny,
              onClick: () => {
                run('open', { target: 'logs' }, (payload) => payload.open?.ok === false
                  ? { kind: 'error', text: t('actionFailed', { error: payload.open.error ?? '' }) }
                  : null)
              },
            }, t('openLogs')),
          ),
          h('span', null, `${t('logFile')}: ${bytes(ready.log?.size ?? 0)}`),
        )
      }

      return h('div', { className: 'dsb-card', 'data-dsh-backup': '' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        header,
        meta,
        noticeNode,
        ready === undefined ? null : h('div', null,
          h('div', { className: 'dsb-section-head' },
            h('h5', { className: 'dsb-section-title' }, t('pointsHeading')),
            h('span', { className: 'dsb-count' },
              t('pointCount', { n: ready.pointCount }) + ' · ' + t('totalSize', { size: bytes(ready.totalBytes) })
              + ' · ' + t('lastBackup', { time: ready.lastBackupAt ?? t('never') })),
          ),
          list,
        ),
        offline,
        diagnosticsBlock,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-backup: dictionaries')
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: '@matsiwolffie/dsh-backup',
          locale: NS,
        }, BackupCard))
      },
    }
  },
})
