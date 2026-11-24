# DSH 备份与恢复 · Backup & Restore Points

给 **DeepSeek Harness 桌面端** 的备份插件：在工作区里生成一个独立的 `dsh-backups` 文件夹，
一键把 DSH 的配置、会话、本机存储与附件存成「还原点」，并可随时恢复；
文件夹里还带一个双击即用的**离线恢复程序**，DSH 崩溃打不开时也能救回来。

- 应用内一个卡片完成备份/恢复，无需命令行
- 还原点是普通文件夹，离线程序只依赖 Windows 自带 PowerShell
- 恢复前自动保存当前状态（可反悔）
- **零依赖、无网络请求、无遥测**；登录凭据默认不备份
- 每个还原点包含 `manifest.json` 与各部分数据，可直接拷走归档

> 平台：插件本体跨平台，但**离线恢复程序仅支持 Windows 10/11**（macOS/Linux 可正常使用应用内备份与恢复）。
> 要求：DSH `>= 0.2.2-rc.5`（安装时由 `engines.dsh` 校验）。

---

## 安装

> ⚠️ 不要在「添加插件」里直接填本仓库的 GitHub 地址：DSH 会把它当作 git 依赖，要求本机装有 Git，
> 没有 Git 时会报 `ERR_PNPM_GIT_RESOLVE_FAILED`。请下载 ZIP 或 clone 后选择本地目录安装。

### 方式一：本地目录（推荐，无需发布）

1. 下载本仓库：`git clone https://github.com/MatsiWolffie/dsh-backup.git`，或下载 ZIP 并解压。
2. 打开 DSH → **插件（Plugins）** → **添加插件** → 选择 `dsh-backup` 目录（或粘贴其绝对路径）。
3. 安装完成后，在插件列表确认 **备份与恢复** 处于启用状态。

### 方式二：npm（发布后）

若你的 DSH 版本支持在「添加插件」中填写包名，可填 `@matsiwolffie/dsh-backup`。
包尚未发布时请使用方式一。

### 安装后

打开 **插件 → 备份与恢复**，卡片会显示备份位置与还原点列表。

> 注意：插件由两部分组成——页面卡片（客户端）与备份服务（Host）。如果只在插件页关掉了本插件，
> 卡片仍可能显示，但按钮会报 `forbidden` / `HTTP 403/404/405`；启用插件并刷新页面即可。

### 从 V1.0.0 升级

- V1.0.0 的离线恢复会整目录替换 profile，导致 `node_modules` 与已安装插件丢失；V1.0.1 已改为合并覆盖。
- 升级方式：重新下载 V1.0.1 的 ZIP 并重新添加插件（或 `git pull`），然后打开一次插件页，
  让 `dsh-backups` 里的 `restore.ps1` 刷新到新版本。
- 已经因 V1.0.0 丢失插件的：在插件页重新安装插件即可，会话与备份数据不受影响。

---

## 使用

### 应用内备份

1. 在卡片点 **立即备份**（默认不含登录凭据）。
2. 需要连登录状态一起恢复时，先勾选 **同时备份登录凭据** —— 还原点会包含明文
   `.credentials.yaml`，请勿分享该目录。
3. 备份位置默认是当前工作区下的 `dsh-backups`，卡片顶部可直接复制路径或打开文件夹。

### 应用内恢复

1. 在还原点行点 **恢复** → **确认恢复**。
2. 插件会先自动生成一份「自动快照」还原点，再覆盖当前数据。
3. **完全退出 DSH 后重新打开**，恢复才会生效。

> 恢复时 DSH 仍打开着的会话会**保持不变**：运行中的进程会继续向这些会话日志追加事件，
> 直接替换会造成日志断层。重启后再恢复一次即可包含它们，或改用离线恢复。

### DSH 崩溃、无法打开时：离线恢复

1. **先完全退出 DSH**（任务栏图标右键退出；无响应时用任务管理器结束 `DeepSeek Harness`）。
2. 打开备份文件夹，**双击 `恢复DSH.cmd`**。
3. 按列表序号选择还原点（也可把还原点文件夹或 `.zip` 拖到 `恢复DSH.cmd` 上），输入 `y` 确认。
4. 程序先把将被覆盖的文件复制到 `%USERPROFILE%\.dsh\.dsh-backup\replaced-<时间>\` 作为回滚副本，
   再**合并覆盖**：只覆盖还原点里存在的文件，`node_modules` 等未包含的文件保留；完成后重新打开 DSH。

脚本会先检测 DSH 进程，仍在运行时拒绝执行；确认已退出仍被误判时可加 `-Force`。

---

## 备份内容

| 部分 | 内容 | 说明 |
|---|---|---|
| `profile/` | `profiles/<profile>` 下的 DSH 配置 | 排除 `node_modules`、日志 |
| `sessions/` | 会话记录 | 完整会话日志 |
| `storages/` | 本机存储 | 工作区列表、插件缓存等 |
| `attachments/` | 附件 | 粘贴进会话的图片/文件 |
| `credentials` | `.credentials.yaml` | **默认不备份**，勾选后才写入，明文 |

不包含：`node_modules`（可重装）、`logs`、`dsh-runtimes` / `dsh-ops` 等已下载运行时。

恢复点目录：

```
dsh-backups/
├─ 恢复DSH.cmd          ← 双击运行（Windows）
├─ restore.ps1
├─ 使用说明.md
├─ .gitignore           ← 插件自动写入，整目录默认不进版本库
└─ points/
   └─ 20261124-182922/
      ├─ manifest.json
      ├─ profile/ sessions/ storages/ attachments/
      └─ credentials    ← 仅勾选时存在
```

---

## 日志与诊断

- 操作日志：`dsh-backups/logs/plugin.log`，约 512 KB 后滚动为 `.log.1`，只保留一份旧文件。
- 记录：备份/恢复/删除的开始与结束、还原点 ID、文件数/字节、耗时、失败部分与错误原文、挂载状态、
  HTTP 拒绝与工具错误；**不记录**登录凭据、会话/附件内容或请求体。
- 离线恢复程序写 `dsh-backups/logs/restore-offline.log`（版本、选择、每部分结果、错误）。
- 卡片底部「诊断」：**复制诊断信息**（主目录显示为 `%USERPROFILE%`，含插件/DSH 版本、路径、
  挂载状态、上次恢复与最近日志）和**打开日志文件夹**。分享日志前请自行检查是否含用户名或路径。
- 升级插件后请打开一次插件页（或做一次备份），让备份目录里的 `restore.ps1` 也刷新到新版本；
  旧的还原点文件不会自动更新。
- 备份位置在第一次使用时固定（记录在 `%USERPROFILE%\.dsh\.dsh-backup\location.json`），
  新增工作区不会把备份目录切走；已有备份的工作区会被优先沿用。

## 隐私与安全

- **登录凭据默认不备份**；勾选后为明文，`dsh-backups` 文件夹请勿上传网盘或分享。
- 无论是否含凭据，还原点都包含会话与附件等私有数据；插件会自动写入
  `dsh-backups/.gitignore`，让整个目录默认不进 Git。
- 应用内恢复会覆盖 `DSH_HOME` 下的数据，但会先自动快照；删除还原点不可撤销。
- 备份服务只响应同源请求（跨站请求一律拒绝），未做额外账号校验，建议在本机使用。
- 离线程序只操作 `DSH_HOME` 与自身目录；`.cmd` 使用 `-ExecutionPolicy Bypass` 运行本地
  `restore.ps1`，脚本内容可自行审阅。
- 导入 `.zip` 还原点时会解压到系统临时目录；请只选择自己生成的还原点文件。

发现安全问题请勿公开提交 issue，见 [SECURITY.md](SECURITY.md)。

---

## 卸载与残留

在 **插件** 页停用或卸载即可移除插件本身。以下数据会保留，按需手动删除：

- 工作区中的 `dsh-backups/`（还原点与离线程序）
- `%USERPROFILE%\.dsh\.dsh-backup\`（恢复回执、被替换数据的回滚副本）

---

## 故障排查

| 现象 | 处理 |
|---|---|
| 按钮报 `forbidden` / `HTTP 403/404/405` | 插件 Host 部分未加载，通常是插件被停用：启用后刷新页面 |
| 恢复完成但界面没变化 | 完全退出并重开 DSH |
| 提示“备份服务未响应” | 同上；仍不行请重启 DSH |
| 离线程序提示 DSH 仍在运行 | 先退出 DSH；确认已退出仍误判时加 `-Force` |
| 离线恢复后插件页空白、插件全没了 | V1.0.0 的已知问题（整目录替换）；升级 V1.0.1 后重新安装插件 |
| 新增工作区后看不到旧备份 | 1.0.3 起备份位置固定；升级后自动沿用已有备份的工作区，旧备份仍在原工作区的 `dsh-backups` |
| 恢复时部分文件被占用 | 关闭 DSH 后用离线恢复程序完成 |
| 插件页没有卡片 | 确认插件已安装并启用，然后刷新页面 |
| 出错但不知道原因 | 卡片「诊断」→「复制诊断信息」，附上 `dsh-backups/logs/plugin.log` 最后几十行 |

日志与回执：`dsh-backups/logs/` 与 `%USERPROFILE%\.dsh\.dsh-backup\last-restore.json`。

---

## 开发

零依赖，只使用 Node 内置模块；客户端为手写 `window.__ModuleLoader__` 模块，无构建步骤。

```bash
node --check index.js && node --check client.js && node --check lib/engine.js
node test/log.test.mjs          # 日志格式/滚动/清洗
node test/diagnostics.test.mjs  # 诊断信息：BOM 回执、单元素数组、路径脱敏
node test/location.test.mjs     # 备份位置固定：新增工作区不切换、已有备份优先
node test/engine.test.mjs       # 引擎：备份/恢复/删除/实时会话保护/凭据开关
node test/tool.test.mjs         # Agent 工具 dsh_backup
```

改包名时需要同步三处：`package.json` 的 `name`、`client.js` 的模块 `id` 与
`plugins.bundle.config` 的 `key`、`cordis.patch.yml` 的 `name`。CI 会运行语法检查与测试。

目录结构：

```
dsh-backup/
├─ index.js          Host：HTTP 路由 + dsh_backup 工具
├─ client.js         客户端：插件页卡片
├─ lib/engine.js     备份/恢复引擎
├─ restore/          离线恢复程序（PowerShell）与写入备份目录的模板
├─ locale/           en/zh 插件标题与描述
├─ icon.svg
├─ cordis.patch.yml
└─ test/
```

---

## English

A backup and restore-point plugin for the DeepSeek Harness desktop app. It writes a
`dsh-backups` folder into the current workspace with the profile configuration, session
logs, local storage, and attachments, plus a double-click PowerShell restore program for
when DSH cannot start. Back up and restore from the card under **Plugins → Backup &
Restore**; restoring snapshots the current state first, keeps sessions DSH still has open,
and needs a DSH restart. Sign-in records are **opt-in** and plain text when enabled; the
folder ships a generated `.gitignore` so it never lands in Git by accident. No
dependencies, no network calls, no telemetry. The offline restore program is Windows-only;
in-app backup and restore work on macOS and Linux too.

Requires DSH >= 0.2.2-rc.5. Install by adding this directory in **Plugins → Add plugin**.

---

## 作者与版权

- 代码由 **DeepSeek Harness Agent**（AI）生成
- 版权与项目维护：**MatsiWolffie**

## 许可

[MIT](LICENSE) © 2026 MatsiWolffie
