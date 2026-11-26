# DSH 备份与恢复 · Backup & Restore Points

面向 **DeepSeek Harness 桌面端（DSH Desktop）** 的本地备份/还原点插件：在工作区内创建 `dsh-backups` 文件夹，把 DSH 配置、会话、本机存储与附件保存为还原点，并附带一个可在 DSH 无法启动时使用的离线恢复程序。

当前版本：**1.0.5**

> **支持范围（V1.0.5）**
> - 当前版本**仅在 Windows 11 上提供支持与验证**。
> - Windows 10、macOS、Linux 及其他环境**未支持、未验证**，请不要将其视为可用环境。
> - 要求 DSH 桌面端 **`>= 0.2.2-rc.5`**（开发/测试版本为 `0.2.2-rc.5`，与 `package.json` 的 `engines.dsh` 一致）。
> - 要求 Node.js **`>= 20`**（DSH 自带运行时，用户无需单独安装）。
> - 离线恢复使用 Windows 11 自带的 **Windows PowerShell 5.1**，不需要额外安装。

> ⚠️ **重要数据安全提示**
> - 本插件是**本地备份与恢复辅助工具**，不能替代完整的个人数据保护方案。
> - 备份目录位于 DSH 工作区内；删除、移动、格式化或损坏该工作区，可能导致其中的备份及还原点一起丢失。
> - 请自行保管原始文件、备份文件和恢复所需的数据，并保护备份目录所在磁盘。
> - 请定期检查备份是否完整，并为重要数据保留独立的额外副本。
> - 完整责任说明见 [数据安全与免责声明](#7-数据安全与免责声明)。

---

## 1. 项目简介

DSH 备份与恢复把 DSH Desktop 的以下内容保存到工作区内的 `dsh-backups` 文件夹：

- Profile 配置；
- 会话记录；
- 本机存储；
- 附件；
- 可选的登录凭据（默认关闭）。

每个还原点都是普通文件夹，包含 `manifest.json` 与各部分数据，可直接归档。插件还会写入离线恢复程序（`恢复DSH.cmd` + `restore.ps1`），用于 DSH 无法启动时恢复。

插件无运行时依赖、无网络上传、无遥测；备份和恢复的读写都在本机完成。

---

## 2. 主要功能

- **跨工作区发现备份目录**：每次重新检索 DSH 已注册工作区和当前工作区，不再依赖固定的绝对路径。
- **单一目录原则**：只有一个可访问的 `dsh-backups` 时才自动使用；没有时在合适工作区创建。
- **安全阻断**：发现多个 `dsh-backups`，或任一已注册工作区无法检查时，停止自动选择并阻断备份、恢复、删除。
- **多目录提示与重新检索**：插件页列出全部候选路径和无法检查的工作区，用户手动处理后可以“重新检索”。
- **应用内备份与恢复**：备份、恢复、删除、打开目录和诊断集中在插件页卡片中。
- **离线恢复程序**：DSH 无法启动时，在 DSH 完全退出后使用 Windows 11 PowerShell 恢复。
- **恢复前安全快照**：应用内恢复会先创建当前状态的快照，并避免覆盖 DSH 仍在使用的会话。
- **合并覆盖**：恢复只覆盖还原点中存在的文件，`node_modules` 以及还原点中没有的文件会保留。
- **凭据默认不备份**：只有显式勾选后才写入明文 `.credentials.yaml`。
- **`.gitignore` 保护**：备份目录会自动写入 `.gitignore`，避免还原点误入版本库。
- **本地诊断日志**：`dsh-backups/logs/` 中的操作日志与离线恢复日志，便于排查问题。

---

## 3. 适用环境与系统要求

### 支持的环境

| 项目 | 要求 |
|---|---|
| 操作系统 | **Windows 11**（当前唯一支持并验证的系统） |
| DSH | DeepSeek Harness 桌面端 `>= 0.2.2-rc.5`；开发/测试版本 `0.2.2-rc.5` |
| Node.js | `>= 20`（由 DSH 自带运行时提供；与 `engines.node` 一致） |
| 离线恢复 | Windows 11 自带 Windows PowerShell 5.1 |
| 安装方式 | DSH 插件页添加本地插件目录 |

### 不支持或未验证的环境

- Windows 10；
- macOS；
- Linux；
- Windows Server、Windows on ARM 等其他 Windows 变体；
- 未达到 `0.2.2-rc.5` 的 DSH 版本；
- 其他未在 Windows 11 + DSH `0.2.2-rc.5` 上实际验证的环境。

本项目的“支持”以**实际验证过的环境**为准，不以代码理论上可能运行作为兼容性承诺。

> 说明：`package.json` 的 `engines` 只声明 DSH 与 Node 版本要求；当前 README 的 Windows 11 支持范围是发布支持范围，不通过修改 `package.json` 来扩大。

---

## 4. 安装方法

### 方式一：本地目录或 ZIP（推荐）

1. 打开 [Releases](https://github.com/MatsiWolffie/dsh-backup/releases)，下载最新版本的 **Source code (zip)**，或克隆仓库。
2. 解压后确认选中目录中直接包含 `package.json`。
3. 打开 DSH → **插件（Plugins）** → **添加插件** → 选择该目录。
4. 在插件列表确认 **备份与恢复** 已启用。
5. 打开 **插件 → 备份与恢复**，卡片应显示备份位置、还原点列表和诊断信息。

> ⚠️ 不要在“添加插件”里直接填写本仓库的 GitHub 地址：DSH 会把它当作 git 依赖，要求本机安装 Git；没有 Git 时会报 `ERR_PNPM_GIT_RESOLVE_FAILED`。请下载 ZIP 或使用本地目录。

### 方式二：npm

当前 npm 渠道尚未发布，请使用上面的本地目录/ZIP 方式。不要从非官方来源安装同名包。

### 从 1.0.3 升级到 1.0.4

1. 用 1.0.4 的 ZIP 重新添加插件（或更新本地插件目录）；
2. 打开一次插件页，让 `dsh-backups/restore.ps1` 刷新到 1.0.4；
3. 旧备份保留在原工作区；
4. 1.0.4 **不再读取** 旧的 `location.json`，该文件可以保留，但不再作为备份位置依据；
5. 如果存在多个 `dsh-backups`，先按第 6 节手动只保留一个，再重新检索。

### 从 1.0.4 升级到 1.0.5

1. 下载 V1.0.5 发布页提供的 Source code (zip)，解压后选择直接包含 `package.json` 的目录，按原有方式更新或重新添加插件；
2. 打开一次插件页，让 `dsh-backups/restore.ps1` 刷新到 1.0.5；
3. 原有还原点继续保留，无需迁移旧备份；
4. 不需要修改旧 `manifest.json`；
5. 使用离线恢复前仍须完全退出 DSH。

---

## 5. 备份与恢复的基本说明

### 应用内备份

1. 在插件卡片点击 **立即备份**。
2. 默认不包含登录凭据；需要恢复登录状态时，先勾选 **同时备份登录凭据**。
3. 勾选后，还原点内会有明文 `.credentials.yaml`，请勿分享该还原点目录。
4. 还原点保存在当前确定的工作区 `dsh-backups/points/<编号>/` 中。

备份内容：

| 部分 | 内容 | 说明 |
|---|---|---|
| `profile/` | `profiles/<profile>` 下的 DSH 配置 | 排除 `node_modules`、日志 |
| `sessions/` | 会话记录 | 完整会话日志 |
| `storages/` | 本机存储 | 工作区列表、插件缓存等 |
| `attachments/` | 附件 | 粘贴进会话的图片/文件 |
| `credentials` | `.credentials.yaml` | 默认不备份；勾选后为明文 |

不包含：`node_modules`、DSH 日志、`dsh-runtimes`/`dsh-ops` 等已下载运行时。

### 应用内恢复

1. 在还原点行点击 **恢复** → **确认恢复**。
2. 插件会先自动创建一份当前状态的安全快照，再按“合并覆盖”方式恢复。
3. 恢复只覆盖还原点中存在的文件；还原点中没有的文件和 `node_modules` 会保留。
4. DSH 当前仍打开的会话会被保留；完全退出 DSH 再恢复一次，或使用离线恢复，才能包含这些会话。
5. 恢复后必须**完全退出 DSH 并重新打开**，配置和会话才会按还原点生效。
6. 如果有部分文件被占用，插件会列出失败部分；此时请在 DSH 完全退出后使用离线恢复程序。

> **凭据注意**：恢复前自动生成的安全快照默认**不包含登录凭据**。如果要恢复的还原点包含凭据，当前登录状态可能被覆盖，且不能通过该安全快照自动找回。请在恢复前另行保存当前登录状态，或避免恢复含凭据的还原点。

### 离线恢复（Windows 11）

1. **先完全退出 DSH**（任务栏图标右键退出；无响应时用任务管理器结束 `DeepSeek Harness`）。
2. 打开备份文件夹，双击 `恢复DSH.cmd`。
3. 按列表序号选择还原点（也可把还原点文件夹或 `.zip` 拖到 `恢复DSH.cmd` 上），输入 `y` 确认。
4. 程序先把将被覆盖的文件复制到 `%USERPROFILE%\.dsh\.dsh-backup\replaced-<时间>\` 作为回滚副本，再**合并覆盖**。
5. 完成后重新打开 DSH。

离线恢复只支持 Windows 11；脚本会检测 DSH 进程，仍在运行时拒绝执行。确认已退出仍被误判时，可在命令行加 `-Force`。

离线恢复在写入前会执行 **Reparse Point（符号链接 / 目录联接）安全检查**，覆盖 `DSH_HOME`、备份源、恢复目标、回滚路径、递归复制路径，以及 ZIP 解压过程中实际创建的临时目录和目标路径；检测到不允许的重解析点，或无法确认路径属性时，恢复会**中止**。该检查已在 Windows 11 + Windows PowerShell 5.1 下通过真实 Junction 测试；本轮安全更新累计 **214 项通过、1 项跳过**（Symlink）。Symlink 与权限拒绝场景尚未动态验证；检查通过后路径仍可能被本地替换（TOCTOU），因此**不能声称已绝对消除路径逃逸**。仍保持 V1.0.4 的 manifest 兼容性与 Windows 11 支持范围。

---

## 6. 备份目录位置与工作区迁移

### 目录结构

```text
dsh-backups/
├─ 恢复DSH.cmd          ← 离线恢复入口（Windows 11）
├─ restore.ps1
├─ 使用说明.md
├─ .gitignore           ← 插件自动写入，整个目录默认不进版本库
├─ logs/                ← 插件日志与离线恢复日志
└─ points/
   └─ 20261125-091857/
      ├─ manifest.json
      ├─ profile/ sessions/ storages/ attachments/
      └─ credentials    ← 仅勾选凭据时存在
```

### 插件如何定位备份目录

每次需要确定备份位置时，插件重新检索：

1. DSH `workspaceRegistry` 中所有**已注册工作区**；
2. 当前工作区服务（`workingDirectory.defaultDirectory`）。

不会扫描未注册的任意磁盘目录，也不做全盘搜索。

| 检索结果 | 行为 |
|---|---|
| **0 个**，且所有工作区都可检查 | 在可访问的合适工作区创建新的 `dsh-backups` |
| **恰好 1 个**，且所有工作区都可检查 | 直接使用该目录，保留所有已有数据 |
| **2 个或更多** | 停止自动选择，阻断备份、恢复、删除；列出全部候选路径 |
| **任一已注册工作区无法检查** | 停止并阻断；不创建新目录，避免数据分叉 |

多个目录时，插件**不会自动选择、合并、迁移、覆盖或删除**。请手动检查这些目录，把不需要的移出 DSH 工作区，只保留一个，然后回到插件页点 **重新检索**。

### 手动迁移

- 建议先完全退出 DSH；
- 把 `dsh-backups` 文件夹移动到另一个 DSH 工作区；
- 如果旧路径仍然存在，插件会看到多个目录并阻断，需要把旧目录移走或删除；
- 重新打开 DSH 后点“重新检索”；
- 不要直接删除存放备份的工作区，删除前先迁移 `dsh-backups`。

### 卸载重装

- 卸载插件不会删除工作区里的 `dsh-backups`；
- 重装后，如果原工作区仍在 DSH 注册表中，插件会重新发现并复用该目录；
- 如果存在多个目录，按上面的多目录规则阻断；
- 旧 `location.json` 不再参与定位，可保留但不要依赖。

### 安全边界

- 插件只能看到 DSH 已注册的工作区和当前工作区；
- 放在未注册目录中的 `dsh-backups` 不会被自动发现；
- 工作区路径不可访问、工作区列表中残留已删除路径时，插件会阻断，需先修复 DSH 工作区列表或权限。

---

## 7. 数据安全与免责声明

请在使用前完整阅读本节。以下内容适用于本插件及由它生成的备份、还原点和离线恢复程序。

1. **辅助工具**：本插件是本地备份与恢复辅助工具，不能替代用户自己的完整数据保护方案、系统备份、版本控制或专业数据恢复服务。

2. **工作区风险**：备份目录位于 DSH 工作区内。用户删除、移动、格式化或损坏该工作区，可能导致其中的备份及还原点丢失。

3. **保管责任**：用户有责任妥善保管自己的原始文件、备份文件和恢复所需的数据，并确保备份目录所在磁盘具有适当的安全保护。

4. **访问与隐私**：用户有责任防止未经授权的人员访问、复制、传播或获取自己的备份文件。如果用户将备份存放在共享目录、公共设备或不安全的存储介质中，可能产生隐私泄露风险。

5. **定期验证与独立副本**：用户应定期检查备份是否存在、是否完整，并在重要数据场景下保留独立的额外副本。不应将单一备份目录视为唯一的数据安全保障。

6. **按现状提供**：插件按现状（as is）提供。插件维护者不保证在所有环境下均能避免数据丢失、文件损坏、隐私泄露、恢复失败或服务中断。

7. **用户自身责任**：对于因用户误操作、主动删除工作区、设备故障、存储介质损坏、未经授权访问、不安全的存储方式或不可控环境因素造成的损失，用户应自行承担相应的数据管理和安全保护责任。

8. **责任限制**：在适用法律允许的范围内，插件维护者不对因使用或无法使用本插件而产生的间接、附带或后果性损失承担责任。本声明不排除或限制根据适用法律不得排除或限制的责任。

> 如果你需要比本插件更完整的数据保护、审计或合规能力，请使用组织认可的备份与安全方案。

---

## 8. 卸载、重装与故障排查

### 卸载与重装

- 在 **插件** 页停用或卸载即可移除插件本身；
- 工作区中的 `dsh-backups/`（还原点、离线程序、日志）会保留；
- `%USERPROFILE%\.dsh\.dsh-backup\` 中可能保留旧的 `location.json`、恢复回执或 `replaced-<时间>` 回滚副本；其中可能包含重要数据，删除前请自行确认；
- 重装后，插件会重新检索已注册工作区；如果原备份目录唯一且可访问，会继续使用；多个目录则会阻断。

### 故障排查（Windows 11）

| 现象 | 处理 |
|---|---|
| 插件页没有卡片 | 确认插件已安装并启用，刷新页面；必要时重启 DSH |
| 按钮报 `forbidden` / `HTTP 403/404/405` | 插件 Host 部分未加载，通常是插件被停用；启用后刷新 |
| 提示备份目录需要处理 / `multiple` / `blocked` | 按提示移走多余的 `dsh-backups`，修复无法访问的工作区，然后点“重新检索” |
| 恢复完成但界面没变化 | 完全退出并重新打开 DSH |
| 恢复时部分文件被占用 | 关闭 DSH 后用离线恢复程序完成 |
| 离线程序提示 DSH 仍在运行 | 先退出 DSH；确认已退出仍误判时加 `-Force` |
| 离线恢复后插件页空白、插件全没了 | V1.0.0 的已知问题（整目录替换）；升级到 V1.0.1 或更高版本后重新安装插件 |
| 新增工作区后看不到旧备份 | 插件会重新检索所有已注册工作区；若存在多个目录或某个工作区无法检查，会停止自动处理 |
| 出错但不知道原因 | 查看 `dsh-backups/logs/plugin.log` 或离线恢复日志；分享前请检查是否含用户名或路径 |

日志与回执：

- 插件日志：`dsh-backups/logs/plugin.log`；
- 离线恢复日志：`dsh-backups/logs/restore-offline.log`；
- 恢复回执：`%USERPROFILE%\.dsh\.dsh-backup\last-restore.json`。

---

## 9. 版本说明与 Release

- 当前版本：**1.0.5**
- 项目仓库：<https://github.com/MatsiWolffie/dsh-backup>
- 下载最新版本：<https://github.com/MatsiWolffie/dsh-backup/releases>
- V1.0.4 发布说明：[`docs/RELEASE_NOTES_V1.0.4.md`](docs/RELEASE_NOTES_V1.0.4.md)
- V1.0.5 发布说明：[`docs/RELEASE_NOTES_V1.0.5.md`](docs/RELEASE_NOTES_V1.0.5.md)
- 历史变更：[`CHANGELOG.md`](CHANGELOG.md)
- 安全报告：[`SECURITY.md`](SECURITY.md)
- 贡献说明：[`CONTRIBUTING.md`](CONTRIBUTING.md)

V1.0.4 主要变化：

- 跨已注册工作区和当前工作区检索备份目录；
- 移除 `location.json` 固定路径依赖；
- 多个目录或无法检查的工作区时阻断，并显示全部候选；
- 用户手动清理后可以重新检索；
- 当前版本仅支持 Windows 11，要求 DSH `>= 0.2.2-rc.5`。

V1.0.5 主要变化：

- 离线恢复新增 Reparse Point 安全检查，覆盖 `DSH_HOME`、备份源、恢复目标、回滚路径、递归复制路径，以及 ZIP 解压过程中实际创建的临时目录和目标路径；
- 检测到不允许的重解析点或无法确认路径属性时中止恢复；
- Windows 11 下真实 Junction 测试通过；累计 214 PASS、1 SKIP（Symlink 未动态验证）；
- 保留 V1.0.4 的 manifest 兼容性与 Windows 11 支持范围。

> 正式发布后，请以 Releases 页面显示的版本和说明为准。

---

## 作者与版权

- 代码由 **DeepSeek Harness Agent**（AI）生成
- 版权与项目维护：**MatsiWolffie**

## 许可

[MIT](LICENSE) © 2026 MatsiWolffie

---

## English

**DSH Backup & Restore Points** is a local backup and restore-point plugin for **DeepSeek Harness Desktop (DSH Desktop)**, supported in this release on **Windows 11 only**. It stores DSH profile configuration, session logs, local storage, and attachments in a `dsh-backups` folder inside a DSH workspace, and ships a Windows 11 offline restore program for situations where DSH cannot start.

Current version: **1.0.5**

> **Support scope (V1.0.5)**
> - Supported and verified on **Windows 11 only**.
> - Windows 10, macOS, Linux, and other environments are **not supported or verified** in this release.
> - Requires DSH Desktop **`>= 0.2.2-rc.5`** (developed/tested with `0.2.2-rc.5`, matching `package.json` `engines.dsh`).
> - Requires Node.js **`>= 20`** (provided by DSH; no separate user installation is required).
> - Offline restore uses the built-in **Windows PowerShell 5.1** on Windows 11.

> ⚠️ **Important data-safety notice**
> - This is a local backup and restore assistant, not a complete personal data-protection solution.
> - The backup folder lives inside a DSH workspace. Deleting, moving, formatting, or damaging that workspace can delete its backups and restore points.
> - You are responsible for your original files, backup files, and all data needed for recovery, and for securing the disk that contains the backup folder.
> - Check backups regularly and keep independent extra copies for important data.
> - See the full [Data Safety and Disclaimer](#data-safety-and-disclaimer) below.

### Overview

DSH Backup & Restore stores:

- profile configuration;
- session logs;
- local storage;
- attachments;
- optional sign-in records (off by default).

Each restore point is an ordinary folder containing `manifest.json` and its data, so it can be archived directly. The plugin also writes an offline restore program (`恢复DSH.cmd` and `restore.ps1`) for recovery when DSH cannot start.

The plugin has no runtime dependencies, performs no external uploads, and includes no telemetry.

### Features

- **Cross-workspace discovery**: re-scans registered DSH workspaces and the current workspace; no fixed absolute path cache.
- **Single-folder rule**: uses a folder only when exactly one accessible `dsh-backups` exists; creates one in an accessible workspace only when none exists.
- **Safe blocking**: if multiple folders exist, or any registered workspace cannot be checked, automatic selection and backup/restore/delete operations stop.
- **Conflict UI and rescan**: the plugin page lists every candidate and every uncheckable workspace, and lets the user rescan after manual cleanup.
- **In-app backup and restore**: backup, restore, delete, open folder, and diagnostics from the plugin card.
- **Offline restore**: recover after DSH has been fully closed, using Windows 11 PowerShell.
- **Safety snapshot before restore**: a snapshot of the current state is written first; live sessions are not replaced.
- **Merge semantics**: only files present in the restore point are overwritten; `node_modules` and files absent from the point are preserved.
- **Credentials off by default**: `.credentials.yaml` is copied only when explicitly enabled, in plain text.
- **`.gitignore` protection**: the backup folder receives a `.gitignore` so restore points do not accidentally enter Git.
- **Local diagnostics**: operation and offline-restore logs under `dsh-backups/logs/`.

### Requirements

| Item | Requirement |
|---|---|
| Operating system | **Windows 11** (the only supported and verified system in this release) |
| DSH | DeepSeek Harness Desktop `>= 0.2.2-rc.5`; developed/tested with `0.2.2-rc.5` |
| Node.js | `>= 20` (provided by DSH; matches `engines.node`) |
| Offline restore | Built-in Windows PowerShell 5.1 on Windows 11 |
| Installation | Add a local plugin directory from the DSH Plugins page |

Not supported or verified: Windows 10, macOS, Linux, other Windows variants, DSH versions below `0.2.2-rc.5`, and environments not actually tested on Windows 11 with DSH `0.2.2-rc.5`.

The `engines` fields in `package.json` describe the DSH and Node requirements. The Windows 11 support scope in this README is the supported release scope; it is not expanded by modifying `package.json`.

### Installation

1. Open [Releases](https://github.com/MatsiWolffie/dsh-backup/releases) and download the latest **Source code (zip)**, or clone the repository.
2. Extract it and make sure the selected directory directly contains `package.json`.
3. In DSH, open **Plugins → Add plugin** and select that directory.
4. Confirm **Back up and restore** is enabled.
5. Open **Plugins → Back up and restore**; the card should show the backup location, restore points, and diagnostics.

Do not paste the GitHub repository URL into “Add plugin”: DSH treats it as a Git dependency and requires Git locally. Without Git it reports `ERR_PNPM_GIT_RESOLVE_FAILED`. Use the ZIP or a local directory.

The npm channel is not currently published; use the local directory/ZIP method. Do not install same-named packages from unofficial sources.

Upgrade from 1.0.3:

1. Re-add the plugin from the 1.0.4 ZIP (or update the local plugin directory).
2. Open the plugin page once so `dsh-backups/restore.ps1` is refreshed to 1.0.4.
3. Existing backups stay in their original workspace.
4. Version 1.0.4 no longer reads the old `location.json`; the file may remain, but it is no longer authoritative.
5. If multiple `dsh-backups` folders exist, keep only one manually (see below), then rescan.

Upgrade from 1.0.4:

1. Download the Source code (zip) from the V1.0.5 release, extract it, and select the directory that directly contains `package.json` to update or re-add the plugin.
2. Open the plugin page once so `dsh-backups/restore.ps1` is refreshed to 1.0.5.
3. Existing restore points are kept; no backup migration is needed.
4. No change to existing `manifest.json` files is required.
5. Fully quit DSH before using the offline restore program.

### Backup and restore

**In-app backup**

1. Click **Back up now**.
2. Sign-in records are excluded by default. Enable **Include sign-in records** only when you need to restore the signed-in state; the restore point then contains plain-text `.credentials.yaml` and must never be shared.
3. Restore points are written under `<workspace>/dsh-backups/points/<id>/`.

Backup contents: profile configuration (excluding `node_modules` and logs), session logs, local storage, attachments, and optional credentials. Downloaded runtimes and `node_modules` are not included.

**In-app restore**

1. Choose a restore point and confirm.
2. The plugin first writes a safety snapshot of the current state.
3. Restore is a merge: files present in the point are overwritten; files absent from the point and `node_modules` are preserved.
4. Sessions still open in DSH are kept. To include them, restart DSH and restore again, or use the offline program.
5. Fully quit and reopen DSH for the restored configuration and sessions to take effect.
6. If some files are locked, the plugin reports the failed parts; close DSH and use the offline restore program.

> **Credentials:** the automatic safety snapshot does **not** include sign-in records by default. If the restore point contains credentials, the current sign-in state may be overwritten and cannot be recovered from that snapshot. Save the current sign-in state separately before restoring a credentials-containing point.

**Offline restore (Windows 11)**

1. Fully quit DSH.
2. Open the backup folder and double-click `恢复DSH.cmd`.
3. Select a restore point by number, or drag a restore-point folder or `.zip` onto the program, then confirm.
4. The program copies files it is about to overwrite to `%USERPROFILE%\.dsh\.dsh-backup\replaced-<timestamp>\`, then performs the merge.
5. Reopen DSH.

Offline restore is supported on Windows 11 only. The script refuses to run while DSH processes are detected; use `-Force` only after confirming DSH has exited.

Before writing, offline restore performs a **Reparse Point (symlink / junction) safety check** across `DSH_HOME`, backup sources, restore targets, rollback paths, recursive copy paths, and the temporary directories and target paths actually created during ZIP extraction. It aborts when a disallowed reparse point is detected or when path attributes cannot be confirmed. This was verified with real junction tests on Windows 11 + Windows PowerShell 5.1; this security update totals **214 passing and 1 skipped** (symlink). Symlink and permission-denied scenarios are not yet dynamically verified, and a checked path could still be replaced locally after the check (TOCTOU), so absolute elimination of path escape is **not claimed**. V1.0.4 manifest compatibility and the Windows 11 support scope are preserved.

### Backup folder location and workspace migration

Each resolution scans the DSH `workspaceRegistry` (registered workspaces) and the current workspace service. It does not scan unregistered directories or perform a full-disk search.

| Result | Behavior |
|---|---|
| **0 folders**, all workspaces checkable | Create `dsh-backups` in a suitable accessible workspace |
| **Exactly 1 folder**, all workspaces checkable | Use it and preserve all existing data |
| **2 or more folders** | Stop automatic selection; block backup/restore/delete; list all candidates |
| **Any registered workspace uncheckable** | Stop and block; do not create a new folder |

The plugin never automatically selects, merges, migrates, overwrites, or deletes folders. To recover normal operation, move all but one `dsh-backups` folder out of the DSH workspaces, then click **Scan again** on the plugin page.

Manual migration:

- Fully quit DSH first.
- Move the `dsh-backups` folder to another DSH workspace.
- If the old path still exists, the plugin sees multiple folders and blocks; remove or move the old one.
- Reopen DSH and click “Scan again”.
- Never delete a workspace that contains backups; migrate `dsh-backups` first.

Uninstall/reinstall:

- Uninstalling the plugin does not delete workspace `dsh-backups`;
- Reinstalling discovers and reuses the folder if the original workspace is still registered;
- Multiple folders still trigger the conflict block;
- The old `location.json` is ignored for resolution.

### Data safety and disclaimer

1. **Assistant, not a complete solution**: this plugin is a local backup/restore assistant. It does not replace a complete data-protection plan, system backup, version control, or professional recovery service.

2. **Workspace risk**: the backup folder is inside a DSH workspace. Deleting, moving, formatting, or damaging that workspace can lose its backups and restore points.

3. **Custody**: you are responsible for keeping your original files, backup files, and recovery data safe, and for securing the disk that contains the backup folder.

4. **Access and privacy**: you are responsible for preventing unauthorized access, copying, disclosure, or acquisition of your backups. Shared directories, public devices, and insecure storage create privacy risks.

5. **Verify and keep independent copies**: check regularly that backups exist and are complete. Keep independent extra copies for important data. A single backup folder is not a sole data-safety guarantee.

6. **As-is**: the plugin is provided “as is”. The maintainer does not guarantee that every environment avoids data loss, file corruption, privacy disclosure, restore failure, or service interruption.

7. **User responsibility**: losses caused by user error, deleting a workspace, device failure, storage-media damage, unauthorized access, insecure storage, or uncontrollable environmental factors are the user’s own data-management and security responsibility.

8. **Liability limitation**: to the extent permitted by applicable law, the maintainer is not liable for indirect, incidental, or consequential losses arising from use of or inability to use this plugin. This notice does not exclude or limit liability that cannot be excluded or limited under applicable law.

> If you need stronger data protection, auditing, or compliance guarantees, use an organization-approved backup and security solution.

### Uninstall, reinstall, and troubleshooting

- Uninstalling the plugin does not remove workspace `dsh-backups/`.
- `%USERPROFILE%\.dsh\.dsh-backup\` may contain the legacy `location.json`, restore receipts, or `replaced-<timestamp>` rollback copies. Review them before deleting; they may contain important data.
- Reinstall and allow the plugin to scan. If the original workspace is registered and its backup folder is unique, it is reused; multiple folders block.

| Symptom | Action |
|---|---|
| No card on the plugin page | Confirm the plugin is installed and enabled; refresh; restart DSH if needed |
| `forbidden` / HTTP 403/404/405 | The Host part is not loaded, usually because the plugin is disabled; enable and refresh |
| Multiple/blocked backup-folder warning | Move extra `dsh-backups` folders, fix inaccessible workspaces, click “Scan again” |
| Restore completed but UI unchanged | Fully quit and reopen DSH |
| Some files locked during restore | Close DSH and use the offline restore program |
| Offline program says DSH is running | Quit DSH; use `-Force` only after confirming it has exited |
| Plugin page blank after V1.0.0 offline restore | Known V1.0.0 issue (whole-directory replacement); upgrade to V1.0.1 or later and reinstall the plugin |
| Old backups missing after adding a workspace | The plugin re-scans registered workspaces; multiple folders or an uncheckable workspace stops automatic handling |

Logs and receipt:

- plugin log: `dsh-backups/logs/plugin.log`
- offline log: `dsh-backups/logs/restore-offline.log`
- restore receipt: `%USERPROFILE%\.dsh\.dsh-backup\last-restore.json`

### Version and releases

- Current version: **1.0.5**
- Repository: <https://github.com/MatsiWolffie/dsh-backup>
- Releases: <https://github.com/MatsiWolffie/dsh-backup/releases>
- V1.0.4 release notes: [`docs/RELEASE_NOTES_V1.0.4.md`](docs/RELEASE_NOTES_V1.0.4.md)
- V1.0.5 release notes: [`docs/RELEASE_NOTES_V1.0.5.md`](docs/RELEASE_NOTES_V1.0.5.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

V1.0.4 changes: cross-workspace discovery, removal of the fixed `location.json` path, blocking on multiple or uncheckable workspaces with a candidate list and rescan, and Windows 11-only support requiring DSH `>= 0.2.2-rc.5`.

V1.0.5 changes: offline restore adds a Reparse Point safety check across `DSH_HOME`, backup sources, restore targets, rollback paths, recursive copy paths, and the temporary directories and target paths created during ZIP extraction; it aborts when a disallowed reparse point is detected or path attributes cannot be confirmed. Verified with real junction tests on Windows 11 (214 passing, 1 skipped for symlink); V1.0.4 manifest compatibility and the Windows 11 support scope are preserved.

> After publication, the Releases page is authoritative for downloadable versions and notes.

### Author and license

- Code generated by **DeepSeek Harness Agent** (AI)
- Copyright and maintenance: **MatsiWolffie**

[MIT](LICENSE) © 2026 MatsiWolffie
