# dsh-script-hub · 脚本中心

**作者：dan yikona** · 反馈 / 建议 / bug 报告：`dansensei2024@outlook.com`
本插件**可以按你自己的需求随意修改**（MIT），改了之后不必署名给我，但保留本段说明更好。

---

> ## ⚠️ 权限声明（安装前请先读这一段）
>
> 这个插件是「帮你在本机跑脚本」的工具，因此它必然会用到下面这些权限。**装上就等于你同意了这些行为**：
>
> | 它会做什么 | 具体范围 | 能不能关 |
> | --- | --- | --- |
> | **读写文件** | 归档根（默认 `D:\DSH代码插件`）与 `watchDirs` 下的脚本、`.md`、`index.json`、`logs/` | 关掉插件即停止；改 `root` 可换位置 |
> | **启动 / 停止进程** | 以子进程运行 `.ps1 .py .js .cmd .bat .vbs .sh`；停止用 `taskkill /PID <pid> /T /F` | 不用「启动」就不会跑任何脚本 |
> | **查询系统信息** | 调用 PowerShell 读进程列表、Windows 计划任务状态、监听端口（`Get-NetTCPConnection`） | 只读，不改系统配置 |
> | **新建后台会话** | 「AI 补全文档 / 检测重要性 / 自动命名」会在**你自己的账号**下开会话，**消耗 token** | 不点这三个按钮就不会消耗 |
> | **不联网** | 没有任何遥测、上报、自动更新；数据只留在本机 | —— |
>
> **风险提示**：它按你的用户权限运行脚本 —— 脚本能做的事它都能做。请只归档你自己写过或确认过安全的脚本；不要用它去跑来路不明的 `.cmd` / `.vbs`。
>
> **卸载 / 停用**：面板右上角或插件管理里关掉 `script-hub`；彻底移除则是删掉 profile 的 `cordis.patch.yml` 里对应的那一行，再删掉插件目录。

---

DeepSeek Harness（DSH）插件。把任意会话里写出的脚本自动归档成「可查、可读、可跑、可写文档」的资产库，并把整套操作放进 Web GUI 侧边栏的一个面板里。

- 归档根目录：`D:\DSH代码插件\<类别>\<项目>\<原文件名>`
- 每个脚本自动生成同名 `.md` 文档
- 面板里能看状态、启动、停止、读日志、写文档、判重要性、看生成的会话
- 所有 AI 判定（补文档 / 判重要性）由插件在 Host 内直接开一个后台会话完成，消耗你自己账号的 token

---

## 1. 功能总览

| 能力 | 说明 |
| --- | --- |
| 自动归档 | 监听工作区目录，脚本一落盘就复制进归档根，按「类别 / 项目」分目录，同时生成 `.md` |
| 手动登记 | `script_hub` 工具的 `register`，或面板「手动归档」输入绝对路径 |
| 历史导入 | 「导入历史脚本」扫描 `watchDirs` ∪ 会话 cwd，列出未归档脚本，可勾选、批量归档 |
| 启动 / 停止 | 子进程方式运行（ps1/py/js/cmd/vbs/sh），输出写独立日志文件，停止用 `taskkill /T /F` |
| 状态核对 | 每个条目的状态是「真的去核对」的：pid 存活 + 进程镜像名匹配 + 对应的 Windows 计划任务状态 |
| 文档体系 | 自动生成骨架 → AI 补全 → 质量校验（不是「有文件就算完成」） |
| 重要性 | high / medium / low 三档，AI 结合脚本源码与所属会话历史判定，高重要性启动前二次确认 |
| 自动命名 | 显示名 = 作用短语 + 版本号（`v2`），版本按「脚本生成来源」的时间排序，不改文件名 |
| 排序筛选 | 名称 / 类别 / 会话 / 重要 / 状态 / 文档状态 / 创建时间；排序（默认、名称、重要度、文档、最近启动、首次归档、创建时间新→旧 / 旧→新） |
| NEW 徽标 | 会话新录入的脚本在名称前显示 `NEW`，点开一次后 24 小时自动消失（从未点击则一直保留） |
| 生成会话 | 插件自己开的每个 AI 会话结束后会自动归档——调用官方 `workspaceRegistry.archiveSession()`，效果与你在侧边栏点「归档会话」完全相同（会话从列表里移走，之后可在归档里找回）；同时把会话存档复制到 `logs\sessions\`、把该会话期间新产出的脚本回扫归档，面板里逐条可见 |

---

## 2. 安装与启用

### 2.0 从仓库安装（最快）

```bash
git clone https://github.com/DanYikona/DSH-script-hub.git
```

把克隆下来的目录整个复制到当前 profile 的 `node_modules` 下（例如 `C:\Users\<你>\.dsh\profiles\desktop\node_modules\dsh-script-hub`），然后在同目录的 `cordis.patch.yml` 里按下面「`cordis.patch.yml`」一节插入本插件行，重启 DSH 即可在侧边栏看到「脚本中心」。

> 也可以 `pnpm add <本机绝对路径>/DSH-script-hub`，效果一样。
> 本机开发时更省事的做法是建一个目录联接：`mklink /J <profile>\node_modules\dsh-script-hub E:\DSH-script-hub-0.2.1`。

### 2.1 目录结构

插件通过 DSH 的 profile 加载，目录结构：

```
script-hub/
├── index.js           # host 侧：路由 + 工具 + 归档/运行/AI 逻辑
├── client.js          # 面板 UI（React + h()，注入 sidebar.panellist / main）
├── cordis.patch.yml   # bundle patch：往 profile 里插入本插件行与默认配置
├── icon.svg
├── package.json
└── README.md
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: script-hub
      name: dsh-script-hub
      config:
        root: 'D:\DSH代码插件'
        watchDirs:
          - 'E:\Administrator\Documents\deepseek-harness\default-workspace'
        autoArchive: true
        pythonPath: 'python'
```

配置项：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `root` | `D:\DSH代码插件` | 归档根目录，`index.json` 与 `logs/` 也在这里 |
| `watchDirs` | 当前工作区 | 监听的目录，脚本落盘即归档 |
| `autoArchive` | `true` | 关掉后只监听不复制，需要手动登记 |
| `pythonPath` | `python`（自动转 `pythonw`） | 运行 `.py` 时用的解释器。写裸名 `python` 时会自动找同目录的 `pythonw.exe`（无控制台窗口）；写绝对路径则原样使用 |

启用：在 DSH 的插件管理里打开 `script-hub`（`plugin_manager` 的 `set_plugin`，`include:script-hub`）。重载方式：先 `enabled:false` 再 `enabled:true`，或直接改文件后重启宿主。

---

## 3. 数据布局

```
D:\DSH代码插件\
├── index.json                 # 条目索引（含 lastRun/importance/aiDoc/generatedSessions/title 等）
├── logs\
│   ├── import-ai.log          # 导入/补文档/判重要性的流水
│   ├── importance.log
│   ├── sessions\             # 插件自己开的 AI 会话存档（*.jsonl.zst，原样复制一份留底）
│   └── <slug>-<时间戳>.log     # 每次运行的 stdout/stderr
├── 机器人\default-workspace\napcat_guard.py
├── 守护与调度\yukui\d80-watch.ps1
├── 蓝牙与硬件\default-workspace\bt_fix.ps1
├── DSH 工具\default-workspace\scan.js
└── 通用\default-workspace\miclevel.ps1
```

每个脚本旁边有同名 `.md`，模板包含：作用 / 运行方式 / 参数与输入 / 依赖 / 注意事项。

---

## 4. 面板

侧边栏「脚本中心」，主区一张表：

- 列：勾选 / 名称（显示名，悬停看真实文件名）/ 一次性标记 / 类别 / 项目 / 会话 / 重要 / 状态 / 最近启动 / 操作
- 顶部按钮：`AI 补全文档 (N)`、`检测重要性 (N)` / `检测选中 (N)`、**`操作 ▾`**、`自动命名`、`检查状态`、`导入历史脚本`、`刷新`
- **`操作 ▾`（批量）**：勾选任意多行后，一个入口做完整类操作——`启动选中`、`停止选中`、`AI 补全文档`、`检测重要性`、`隐藏选中`、`取消隐藏`、`复制路径`、`删除选中`（红色，二次确认）。启动/停止/隐藏逐条执行并显示 `3/8` 进度，删除与 AI 类操作复用上面两条确认条；未勾选时菜单项置灰并提示。
- 筛选栏：搜索（文件名/项目/说明）、类别、会话、状态（含「有计划任务」）、重要度、文档状态、**创建（全部 / 今天 / 7 天内 / 30 天内）**、排序（含**创建时间：新→旧 / 旧→新**）
- 名称前的 `NEW`：只有「归档时新建」的条目才有（`newAt`），点击该行会调 `POST /seen` 记下首次点击时间（`seenAt`）；`seenAt + 24h` 之后自动不再显示，所以「点过但还没到一天」仍然算新。窗口缩放时表格与详情区按 `flex` + `clamp()` 自适应，不会再把文档/日志压没。
- 行操作只有三个按钮：**`启动` / `停止`**（同一个位置，按状态切换）、**`删除`**、**`更多 ▾`**
- 「更多」菜单：`说明`、`日志`、`文档`、`隐藏` / `取消隐藏`、`复制路径`（行在可视区下半部分时菜单向上弹，避免被表格裁掉）
- 标记行右侧的筛选条（与「备份」「旧版」同一套写法）：
  - `一次性`：全部 / 只看(N) / 隐藏
  - `备份`：显示中 / 已隐藏
  - `旧版`：显示中 / 已隐藏
  - `同名`：未合并 / 已合并(N) —— 把同名的启动壳（`.cmd`/`.vbs`）与主体（`.py`/`.ps1`）合成一行，只留主体，行内标 `同名 N`
  - `隐藏`：已隐藏(N) / 显示中(N) —— 「更多 → 隐藏」过的条目默认不出现，点一下才放出来
- 「展开会话」：看插件开过的 AI 会话（类型、会话数、目标数、产物）
- 详情区：`说明 / 文档 / 日志` 三个页签，文档可直接编辑保存（日志页签 5s 轮询一次）

状态列的含义（只有两种字面：「运行中」/「未运行」，细节全部放在悬停提示里）：

| 显示 | 实际含义（悬停可见） |
| --- | --- |
| `● 运行中` | ① 插件自己起的子进程：`pid · 启动于 · 已运行 · 命令行`；② 命令行匹配到的常驻进程：`进程 pythonw.exe · pid · 已运行 · 非本插件启动`；③ 计划任务正在跑：`计划任务 <名字>（Running）` |
| `● 未运行` | 未启动 / 进程已退出（`退出于 · code · 原因`）/ pid 被别的进程复用 / 计划任务 Ready |
| 悬停 | 上面三种情况的信息 + 关联的计划任务名与状态 |

表格是**虚拟滚动**：滚动容器高度随窗口自适应（`flex:1` + `ResizeObserver` 回写可视高度，最小 160px），只渲染可视窗口上下各 6 行的缓冲，一百多条也只是三四十个 DOM 节点，不再有「显示更多」。表头在容器内 `sticky`，行高固定 38px。搜索框 200ms 防抖；面板每 10s 刷新一次。

详情区高度是 `clamp(150px, 34vh, 320px)`：窗口变矮时表格先收缩，文档/日志区不会被挤出可视区（旧版把它写成 `max-height:38%` + `min-height:220px`，小窗口下会被裁掉一半）。

---

## 5. HTTP 接口

所有路由都在 `/api/dsh-script-hub/` 下，且强制 `isLoopback(req) || isSameSite(req)`（非同机或跨站一律 403）。

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `list` | GET | 全量条目（含状态、文档质量、重要性、说明、一次性判定、生成会话） |
| `health` | GET | 根目录可写、监听目录是否存在的自检 |
| `status` | GET | 真实存活核对：`running[] / exited[] / scheduled[] / reconciled` |
| `register` | POST | 手动登记一个脚本路径 |
| `start` / `stop` | POST | 启动 / 停止 |
| `logs` | GET | 读取某条目日志尾部 |
| `doc` / `rename` / `hide` / `seen` / `delete` | GET/POST | 读文档、改名（同步改 `.md` 一级标题）、隐藏/取消隐藏、记录首次点击（`seenAt`，NEW 徽标 24 小时后消失）、删除 |
| `import-scan` / `import-run` / `import-status` | GET/POST | 历史脚本扫描、批量归档、进度 |
| `importance-queue` / `importance-pending` | POST/GET | 旧版「排队」检测（由会话读取队列写回） |
| `importance-run` / `importance-status` | POST/GET | 插件直接开后台会话判定重要性 |
| `ai-start` / `ai-status` / `ai-probe` | POST/GET | 插件直接开后台会话补文档 |
| `autoname` | POST | 按「作用短语 + 版本号」重算显示名 |
| `archive-products` | POST | 按会话补扫产物（调试/补归档用） |

工具面：`script_hub`，`action` ∈ `list | register | start | stop | rename | delete | logs | doc | doc_save | pending | importance_pending | importance_save | session_context`。

---

## 6. 关键机制

### 6.1 归档

`archiveFile(path, extra)` 负责：算类别（`CATEGORY_RULES` 关键词表）、算项目（工作区目录名）、`safeSegment` 清洗路径段、复制文件、写 `.md` 模板、登记进入 `index.json`。`session` 字段记录归属会话标题，`sessionId` 记录会话 id（用于后续取历史）。

### 6.2 监听

`watch(watchDirs, { recursive: true })` + 500ms 去抖：新增/改名脚本即归档；随后 `applyAutoTitles()` 重算显示名。

### 6.3 AI 补文档 / 判重要性（Host 内开会话）

插件与 Host 同进程，直接调用 `ctx.sessionController`：

```js
const { sessionId } = await ctx.sessionController.create({ cwd: root })
await ctx.sessionController.prompt({
  requestId: crypto.randomUUID(),
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: prompt }],
  clientTimeZone: 'Asia/Shanghai',
}, new AbortController().signal)
```

> `ctx.agents.create` 走子代理路线拿不到账号模型传输，会报 `DeepSeek Messages transport failed`（code `TRANSPORT`），必须走 `sessionController`。

- 补文档：`AI_DOC_BATCH = 10` 一批，`AI_DOC_BATCH_TIMEOUT_MS = 20min`，批间自动续跑；判定「写完」= 目标 `.md` 的 mtime ≥ 该批开始时间。
- 判重要性：`IMPORTANCE_BATCH = 20` 一批，`IMPORTANCE_BATCH_TIMEOUT_MS = 8min`，超时停止后续批次并记录原因。

### 6.4 会话历史注入

每个 AI 任务会先抓「脚本所属会话」的历史摘要，拼进 prompt：

- 会话存档：`<sessions>\session-*\session.v4.jsonl.zstd`，是**多帧 zstd 串联**，必须按 magic（`28 b5 2f fd`）逐帧解压
- `readSessionDigest()` 只取 `user/message`、`assistant/message`，过滤运行时提示（`Current runtime context.`、`<system-reminder>`、`[Compressed conversation section]` 等）
- 单脚本上限 1200 字，模型也可以主动调 `script_hub { action: 'session_context', id }` 深读
- 实测一批 49 条：摘要命中 19/20、20/20、6/9，单批最多 2.6 万字符，2 分 37 秒判完

### 6.4.1 插件会话自动归档

AI 补文档 / 判重要性都会在 Host 内新建一个会话（`sessionController.create` + `prompt`）。这一批会话跑完后，`archiveGeneratedSessions(kind, sessionIds, total, sinceMs)` 逐个处理：

1. **官方归档**：`ctx.workspaceRegistry.archiveSession(sessionId)` —— 与你在侧边栏点「归档会话」是同一个公共动词，写完即广播 follow 帧，侧边栏立刻少一条，可在「归档会话」里找回。没有这个动词的老版本会记 `archiveError`，不影响其余步骤。
2. **回扫产物**：扫 `root ∪ watchDirs ∪ cwd` 里该会话期间新出现的脚本，逐个 `archiveFile` 并自动命名。
3. **留底副本**：把会话存档复制到 `logs\sessions\<去 session- 前缀>-<标题>.jsonl.zst`。

三步各自 try/catch，一条会话失败只影响它自己。面板「展开会话」逐条显示：检测重要性 / 补全文档 · 标题 · 目标数 · 产物名 · **已归档 / 未归档（悬停看原因）** · 时间。

### 6.5 文档质量

`docQualityOf(entry)`：读 `.md`，剔除标题/表格/引用行后统计正文字数。

| 状态 | 判定 |
| --- | --- |
| `missing` | 文档不存在 |
| `skeleton` | 含「可在所属会话内让 AI 补写」「骨架模板」「填写模板」 |
| `thin` | 正文 < 80 字，或含「（待补充」「待填写」「TODO」 |
| `ok` | 其余；一次性脚本（带 `> 一次性脚本：` 说明）在正文 < 120 字时也算 ok |

补文档结束后按这个函数复查：`ok` 才标 `aiDoc='done'`，否则退回 `pending`，下次按钮仍然计数。

### 6.6 自动命名

- `title = 作用短语 + 版本号`
- 作用短语：取「说明/文档作用」的首句 → 去 markdown → 截断到 16 字（先切分句，>4 字才用整句；超长先 slice 再 `trimPurpose` 去掉尾部未闭合括号、连接符、ASCII 残词）
- 版本号：同「类别 + 项目 + 基名 + 扩展名」为一族，按脚本生成来源时间排序，第 2 个起标 `v2`、`v3`……
- 同名不同扩展（`x.cmd` 与 `x.py`）不共担版本，改为追加 `(cmd)` / `(py)`
- 短语太短或纯英文 → 退回文件名
- 手动改过名的条目 `titleSource='manual'`，自动命名不覆盖

「脚本生成来源」取该脚本文档/条目所属会话（`sessionId`）对应会话文件的创建时间，取不到才退回条目 `createdAt`。

### 6.7 存活核对

`runStateOf(entry)` 按优先级判定：

1. 子进程句柄还在 → `running`
2. `process.kill(pid, 0)` 失败 → `exited`
3. `tasklist /FI "PID eq N"` 拿镜像名，与扩展名预期（`IMAGE_HINTS`）不匹配 → `reused`（pid 被别的进程复用）
4. 以上都不成立时，看脚本对应的 Windows 计划任务是否 `Running`
5. 拿不到镜像名时保守判 `running`

`reconcileRuns()` 会把非运行态写回 `exitedAt` / `exitReason`，`/list` 每次请求都会先跑一遍。

计划任务映射：`Get-ScheduledTask` 读全量（`TaskName / State / Run`），从 Action 命令行里抓脚本文件名建索引，10 分钟缓存（`TASK_CACHE_TTL_MS`），单任务状态 15 秒缓存（`TASK_STATE_TTL_MS`）。

> `schtasks /FO CSV` 在中文系统输出 GBK，Node 按 UTF-8 解码会全乱码——所以这里走 PowerShell + `[Console]::OutputEncoding = [Text.Encoding]::UTF8`。

### 6.8 PowerShell 的 BOM 坑

PowerShell 5.1 读**无 BOM 的 UTF-8** 脚本会按 GBK 解码：中文注释行末字节被当成 GBK 首字节吃掉换行，下一行代码被并进注释里。实测一个带 `# 作用：…（长驻）` 的探测脚本，紧随其后的 `Start-Sleep` 被整行吃掉，进程 0.5 秒就退出（code=0）。

处理：`ensurePsBom(file)` 在归档复制后与启动前，对非 ASCII 且无 BOM 的 `.ps1/.psm1` 补 `EF BB BF`。

---

## 7. 开发过程（按对话顺序）

这一节按实际需求推进顺序记录，方便回看每个功能是怎么长出来的。

| # | 需求 | 落地 |
| --- | --- | --- |
| 1 | 脚本散落在各会话，想统一收起来 | 归档根 + `index.json` + `.md` 模板 + `register/list` 路由与工具 |
| 2 | 想在面板里直接跑/停脚本、看日志 | `start/stop/logs`，子进程 + 日志文件；`detached:false` + pipe（`detached:true` 会导致 powershell 立即退出且没有输出） |
| 3 | 面板要放到侧边栏 | `window.__ModuleLoader__.load` + `ctx.slots.register({ name: 'sidebar.panellist' })`，fetch 走文档相对路径 `api/...` |
| 4 | 老脚本太多了，想批量收进来 | 「导入历史脚本」：扫描 `watchDirs` ∪ 会话 cwd，三态筛选（全部/只看/隐藏），批量归档 |
| 5 | 名字乱、看不清作用 | 显示名改取文档一级标题，右键改名同步改 `.md`；tooltip 显示真实文件名 |
| 6 | 会话列不准 | 取会话存档里最后一条 `session/title`（多帧 zstd，必须逐帧解） |
| 7 | 想区分一次性脚本、备份、旧版 | `ONE_OFF_NAME` / `BACKUP_NAME` / `VERSION_SUFFIX` 规则 + 面板开关；备份不参与「谁最新」 |
| 8 | 需要知道哪个脚本重要 | 三档重要性 + 筛选 + 高重要性启动二次确认 |
| 9 | 说明书那列太空 | `extractBlurbText`：`# 作用：` → 文件头注释 → docstring，最后回落到文档「作用」一节 |
| 10 | 新会话写的脚本也要进库 | 监听 + 全局 `AGENTS.md` 约定：新增/改写脚本必须 `register` + `doc_save` + `importance_save` + 头部写 `# 作用：一句话` |
| 11 | 文档全是骨架，没人写 | 插件直接开后台会话补文档（`sessionController` 路线；先前 `agents.create` 撞 `TRANSPORT`） |
| 12 | 补完还是空的 | `docQualityOf` 质量判定 + 按钮按 `docNeed` 计数 + 补完复查，不 ok 就回退 |
| 13 | 检测重要性只能排队 | 主界面「检测重要性 (N)」直接起会话；后加「逐条勾选」与分批续跑（曾因 `slice(0,40)` 静默截断 79→40） |
| 14 | AI 判定太单薄 | 注入脚本所属会话历史摘要 + `session_context` 工具 |
| 15 | 生成的会话要归档、名字要规范、要能排序 | 会话产物自动回扫归档（`generatedSessions`）、自动命名、排序与文档筛选 |
| 16 | 状态可能是假的 | 真实存活核对（pid + 镜像名 + 计划任务），并修掉 BOM 导致的「脚本秒退」 |

关键教训（都已在代码注释/本节留痕）：

- `ctx.agents.create` 拿不到账号模型传输，必须 `ctx.sessionController`
- `zstdDecompressSync` 只解第一帧，会话文件是多帧串联
- 归档/启动前的 `.ps1` 必须补 BOM，否则中文注释会吃掉下一行
- 批量任务不要 `slice(0, N)` 静默截断，要么分批续跑要么明确报错
- `detached:true` 起 PowerShell 会立刻退出且没有输出，要用 `detached:false` + 管道
- 计划任务不能用 `schtasks /FO CSV` 解析（GBK），走 PowerShell UTF-8

---

## 8. 性能

首屏与轮询都做过针对性处理，实测（110 条条目、Windows 11、Node 24）：

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| `/list` 首次（插件刚重载） | 15.5 s | 0.14 s |
| `/list` 稳态 | 21–25 ms | 10 ms |
| `/list` 状态缓存过期时（每 3 s） | 2.4 s | 14 ms |
| `/status`（检查状态按钮） | 2.6 s | 5 ms |
| `/list` 响应体 | 154 KB | 138 KB |
| 面板一次渲染的行数 | 110 | 约 40（虚拟滚动窗口） |
| 轮询间隔 | 列表 5 s / 日志 2 s | 列表 10 s / 日志 5 s |

做法：

1. **请求线程不跑 PowerShell**：进程列表、计划任务状态、任务索引、端口探针四类系统查询全部改成 `execFile` 后台刷新，缓存过期时先返回旧值，下一次请求就能拿到新值。
2. **进程查找建索引**：`Get-CimInstance Win32_Process` 只取命令行里带脚本扩展名的行，一次构建「文件名 → 进程」的 Map，`findByCmdline` 从 O(n) 扫描变成 O(1) 查表。
3. **计划任务状态批量取**：原来按任务各起一次 PowerShell，现在一次 `Get-ScheduledTask | ConvertTo-Json` 全量快照，15 秒缓存。
4. **会话标题只读文件尾**：会话存档是多帧 zstd，原来把整个 9 MB 文件读进来逐字节找 magic；改成读最后 2 MB + `Buffer.indexOf` + 按「路径:mtime:size」缓存。
5. **文档标题按 mtime 缓存**，`docQualityOf` / `detectOneOff` / `scriptBlurb` 在一次 `/list` 里各只算一次，并且 110 条并发处理。
6. **开机预热**：插件加载 1.2 秒后自动跑一遍上述查询与条目缓存，用户第一次打开面板时已经是热缓存。
7. **面板侧**：虚拟滚动（固定行高 + 上下占位 + 可视窗口 ±6 行）、搜索 200 ms 防抖、列表轮询降到 10 秒、日志轮询 5 秒、响应体裁掉面板不用的字段（`sha1`/`docHint`/...）。

---

## 9. 已知限制

- 归档按「文件名 + 类别 + 项目」判定版本家族，同名脚本改名后就断代了
- 会话摘要按「会话标题/`sessionId`」匹配；老条目没有 `sessionId` 时只能按标题猜，可能取不到
- AI 判定会消耗账号 token，批量任务建议先小批试跑
- 计划任务映射只认 Action 里的脚本文件名，脚本被任务内嵌调用（`cmd /c xxx`）时可能匹配不到
- 面板对「计划任务运行中」的条目目前只能看，停止仍走 `taskkill`（停任务的能力还没接）
- 插件会话归档调用官方 `workspaceRegistry.archiveSession()`：刚跑完的会话还挂着 turn 时会被拒，插件会重试 6 次（约 9 秒）；仍失败就记下原因，并在下次加载时补归档

## 10. 路线图

- [ ] 对计划任务型条目，停止时优先 `Stop-ScheduledTask`
- [ ] 条目级「无会话摘要」提示，便于补 `sessionId`
- [ ] 版本家族的「改名不断代」：按内容哈希归族
- [ ] 文档模板支持自定义（现在写死在 `docTemplate`）
- [ ] 归档根支持多个（现在单 `root`）

---

## 11. 许可与作者

MIT License.

- **作者**：dan yikona
- **反馈**：`dansensei2024@outlook.com`（建议、bug、想加的字段都可以发）
- **二次修改**：随意改、随意分发，不需要征求同意；如果只是小改动，直接改 `index.js` / `client.js` 即可，注意 `cordis.patch.yml` 里的 `config` 是给使用者覆盖的入口。

---

<sub>dsh-script-hub · built for DeepSeek Harness · dan yikona</sub>
