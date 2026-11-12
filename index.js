/**
 * Script hub (host half).
 *
 * Author: dan yikona <dansensei2024@outlook.com> · MIT
 * 可以按需修改；改动或 bug 反馈欢迎发邮件。
 *
 * Archives every script produced in a DSH session into a per-category / per-project
 * folder under `D:\DSH代码插件`, writes a companion `.md` doc next to each copy,
 * and serves the routes the web panel needs to list, start, stop, and read logs.
 *
 * Auto-archiving has two entry points:
 *  - a recursive fs.watch over the configured workspaces (any new or changed
 *    `.ps1 .py .js .cmd .bat .vbs .sh` file is copied once, debounced);
 *  - the `script_hub` tool, so a model can register a path explicitly and attach
 *    a description/doc it just wrote.
 *
 * The runner keeps the child detached with its stdout/stderr redirected to a log
 * file under `<root>/logs`, so a started script survives the panel closing and its
 * output stays inspectable. Stop = taskkill /T /F on the recorded pid tree.
 */
import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile, execFileSync } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { closeSync, createWriteStream, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { appendFileSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, open as openFile, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'

const name = 'script-hub'
export const inject = ['webServer', 'tools', 'sessionController', 'workspaceRegistry']

const SCRIPT_EXTS = new Set(['.ps1', '.py', '.js', '.mjs', '.cjs', '.cmd', '.bat', '.vbs', '.sh'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh', 'logs', 'script-hub', 'driver_backup_20261103', 'driver_new', '__pycache__', 'site-packages', '.venv', 'venv'])
const DEFAULT_ROOT = 'D:\\DSH代码插件'

const CATEGORY_RULES = [
  ['机器人', /astrbot|napcat|onebot|qq|bot-|_bot|meme_manager|livingmemory/i],
  ['DSH 工具', /dsh|harness|plugin|bundle|scan\.js|repoint|skill/i],
  ['蓝牙与硬件', /bt_|bluetooth|hid|driver|ghost_wlan|kb_|battery/i],
  ['守护与调度', /watch|guard|supervisor|stack|service|schedule|task|sync_/i],
  ['游戏与输入', /dmnote|dm-note|keyviz|adoafi|mumu|keymap|kps/i],
  ['网络与远程', /tailscale|serve|remote|pair|tunnel|ssh/i],
]

const nowISO = () => new Date().toISOString()
const sha1 = (text) => createHash('sha1').update(text, 'utf8').digest('hex')

function slugify(input) {
  const base = input.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return base === '' ? 'script' : base.slice(0, 80)
}

function safeSegment(value, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\.\./g, '')
    .trim()
  return cleaned === '' ? fallback : cleaned.slice(0, 60)
}

function classify(fileName) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(fileName)) return category
  }
  return '通用'
}

function isLoopback(req) {
  const address = (req.socket?.remoteAddress ?? '').toLowerCase()
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

function isSameSite(req) {
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

function ensurePsBom(file) {
  try {
    const buf = readFileSync(file)
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return false
    let ascii = true
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] > 0x7f) {
        ascii = false
        break
      }
    }
    if (ascii) return false
    writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]))
    return true
  } catch {
    return false
  }
}

const TASK_RUNNING = /running|正在运行/i
const TASK_CACHE_TTL_MS = 10 * 60 * 1000
const TASK_STATE_TTL_MS = 15 * 1000
const PROC_CACHE_TTL_MS = 10 * 1000
const PROBE_HOSTS = [
  { port: 6185, label: 'AstrBot WebUI' },
  { port: 6199, label: 'AstrBot aiocqhttp' },
  { port: 6099, label: 'NapCat WebUI' },
]
const IMAGE_HINTS = {
  '.ps1': ['powershell', 'pwsh'],
  '.py': ['python', 'pythonw', 'python3', 'python3.exe', 'py.exe', 'pyw.exe'],
  '.js': ['node'],
  '.mjs': ['node'],
  '.cjs': ['node'],
  '.cmd': ['cmd'],
  '.bat': ['cmd'],
  '.sh': ['bash', 'sh.exe', 'zsh'],
}

// 控制台窗口：优先用 pythonw.exe 跑 .py，避免闪一个黑框（pythonw 没有控制台宿主）
let pythonwProbe = null
function resolvePython(config) {
  const configured = (config.pythonPath ?? '').trim()
  // 写成裸名 python / python.exe 视为「自动」：优先 pythonw.exe，彻底没有控制台窗口；
  // 只有填了绝对路径（或 venv 里的 python.exe）才原样使用。
  const bare = /^python(\.exe)?$/i.test(configured)
  if (configured && !bare) return configured
  if (process.platform !== 'win32') return 'python'
  if (pythonwProbe !== null) return pythonwProbe
  pythonwProbe = 'python'
  const dirs = String(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  for (const dir of dirs) {
    const candidate = join(dir, 'pythonw.exe')
    try {
      if (statSync(candidate).isFile()) {
        pythonwProbe = candidate
        break
      }
    } catch {}
  }
  return pythonwProbe
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function runCommand(entry, config) {
  const file = entry.filePath
  const ext = entry.ext.toLowerCase()
  switch (ext) {
    case '.ps1':
      // -WindowStyle Hidden 是双保险：即使用户把宿主挂在有控制台的终端里，脚本本身也不开窗
      return { cmd: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file] }
    case '.py':
      return { cmd: resolvePython(config), args: [file] }
    case '.js':
    case '.mjs':
    case '.cjs':
      return { cmd: 'node', args: [file] }
    case '.vbs':
      return { cmd: 'wscript.exe', args: ['//B', '//Nologo', file] }
    case '.cmd':
    case '.bat':
      // /d 跳过 AutoRun，避免注册表里的脚本再开一层窗口
      return { cmd: 'cmd.exe', args: ['/d', '/c', file] }
    case '.sh':
      return { cmd: 'bash.exe', args: [file] }
    default:
      return null
  }
}

function docTemplate(entry) {
  const runHint = {
    '.ps1': 'powershell -NoProfile -ExecutionPolicy Bypass -File "<脚本路径>"',
    '.py': 'python "<脚本路径>"',
    '.js': 'node "<脚本路径>"',
    '.cmd': 'cmd /c "<脚本路径>"',
    '.bat': 'cmd /c "<脚本路径>"',
    '.vbs': 'wscript //B //Nologo "<脚本路径>"',
    '.sh': 'bash "<脚本路径>"',
  }[entry.ext.toLowerCase()] ?? '由脚本中心按扩展名选择运行器'

  return `# ${entry.title || entry.name}

| 项 | 值 |
| --- | --- |
| 类别 | ${entry.category} |
| 项目 | ${entry.project} |
| 会话 | ${entry.session || '未标注'} |
| 归档文件 | \`${entry.filePath}\` |
| 来源文件 | \`${entry.srcPath}\` |
| 扩展名 | ${entry.ext} |
| SHA1 | ${entry.sha1} |
| 首次归档 | ${entry.createdAt} |
| 最近更新 | ${entry.updatedAt} |
| 文档状态 | ${entry.docCustomized === true ? '已由会话内 AI 补写' : '骨架模板（可在所属会话内让 AI 补写）'} |

> 说明：本文档的总结由脚本所属会话的模型读取上下文后写入，会消耗该会话 token，不会后台静默生成；需要更新时请在对应会话里重新生成。

## 作用

${entry.description || '（待补充：一句话说明这个脚本解决什么问题。）'}

## 运行方式

\`\`\`
${runHint}
\`\`\`

脚本中心里点「启动」会用同一运行方式在后台执行，标准输出与错误写入 \`${entry.logHint ?? '<root>/logs'}\` 下的日志文件；点「停止」会对进程树执行 taskkill /T /F。

## 输入 / 输出

- 输入：
- 输出：

## 依赖

- 

## 变更记录

- ${entry.updatedAt} 归档/更新
`
}

export function apply(ctx, config = {}) {
  const root = resolve(config.root ?? DEFAULT_ROOT)
  const watchDirs = (config.watchDirs ?? []).map((dir) => resolve(dir))
  const autoArchive = config.autoArchive !== false
  const indexPath = join(root, 'index.json')
  const logDir = join(root, 'logs')

  let entries = new Map()
  const generatedSessions = []
  const logStreams = new Map()
  const children = new Map()
  const procCache = new Map()
  const taskCache = { at: 0, map: new Map() }
  const taskStates = new Map()
  const taskStateCache = new Map()
  const procList = { at: 0, rows: [], map: new Map() }
  const docTitleCache = new Map()
  const statusCache = { at: 0, map: new Map() }
  const taskStateBulk = { at: 0, map: new Map() }
  const portState = { at: 0, rows: [] }
  let loaded = false
  let saveSeq = 0
  let lastRunCheckAt = ''

  const log = (level, message) => {
    try {
      const writer = ctx.logger?.[level]
      if (typeof writer === 'function') writer.call(ctx.logger, `[script-hub] ${message}`)
    } catch {
      // logger is best-effort
    }
  }

  async function loadIndex() {
    if (loaded) return
    loaded = true
    try {
      const raw = JSON.parse(await readFile(indexPath, 'utf8'))
      for (const entry of raw.entries ?? []) entries.set(entry.id, entry)
      for (const record of raw.generatedSessions ?? []) generatedSessions.push(record)
    } catch {
      entries = new Map()
    }
  }

  async function saveIndex() {
    saveSeq += 1
    await mkdir(root, { recursive: true })
    const payload = JSON.stringify({ version: 1, seq: saveSeq, entries: [...entries.values()], generatedSessions }, null, 2)
    await writeFile(indexPath, payload, 'utf8')
  }

  async function archiveFile(srcPath, extra = {}) {
    await loadIndex()
    const stats = await stat(srcPath)
    if (!stats.isFile()) throw new Error(`not a file: ${srcPath}`)
    const ext = extname(srcPath)
    if (!SCRIPT_EXTS.has(ext.toLowerCase())) throw new Error(`not a script extension: ${ext}`)
    const content = await readFile(srcPath, 'utf8').catch(() => '')
    const digest = sha1(content)
    const id = sha1(srcPath).slice(0, 12)

    const existing = entries.get(id)
    const category = safeSegment(extra.category ?? existing?.category ?? classify(basename(srcPath)), '通用')
    const project = safeSegment(extra.project ?? existing?.project ?? basename(dirname(srcPath)), 'general')
    const session = safeSegment(extra.session ?? existing?.session ?? '未标注', '未标注')
    const sessionId = String(extra.sessionId ?? existing?.sessionId ?? '').trim()
    const slug = existing?.slug ?? slugify(basename(srcPath))
    const archiveDir = join(root, category, project)
    if (!archiveDir.startsWith(root + sep) && archiveDir !== root) throw new Error('archive path escapes root')
    const filePath = join(archiveDir, `${slug}${ext}`)
    const docPath = join(archiveDir, `${slug}.md`)

    await mkdir(archiveDir, { recursive: true })
    await copyFile(srcPath, filePath)
    if (ext.toLowerCase() === '.ps1' || ext.toLowerCase() === '.psm1') {
      if (ensurePsBom(filePath)) log('info', `added utf-8 bom for ${basename(srcPath)} (PowerShell 5.1 会把无 BOM 的 UTF-8 当 GBK 读)`)
    }

    const entry = {
      id,
      name: extra.name ?? basename(srcPath),
      slug,
      category,
      project,
      session,
      sessionId,
      ext,
      srcPath,
      filePath,
      docPath,
      sha1: digest,
      size: stats.size,
      description: extra.description ?? existing?.description ?? '',
      createdAt: existing?.createdAt ?? nowISO(),
      updatedAt: nowISO(),
      newAt: existing?.newAt ?? null,
      seenAt: existing?.seenAt ?? null,
      fileCreatedAt: existing?.fileCreatedAt ?? (() => {
        const ms = Number(stats.birthtimeMs) > 0 ? Number(stats.birthtimeMs) : Number(stats.mtimeMs)
        return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
      })(),
      lastRun: existing?.lastRun ?? null,
      runCount: existing?.runCount ?? 0,
      docHint: 'generated',
      docCustomized: existing?.docCustomized ?? false,
    }
    if (!existing && extra.fresh !== false) entry.newAt = entry.createdAt
    fileTimeCache.delete(filePath)
    entries.set(id, entry)

    const docFileExists = await stat(docPath).then(() => true).catch(() => false)
    const flags = classifyEntry(entry.name, ext, filePath, content.slice(0, 16384))
    if (flags.oneOff) {
      entry.oneOff = true
      entry.oneOffReason = flags.oneOffReason
      entry.docHint = 'oneoff'
    } else {
      entry.oneOff = false
      entry.docHint = 'generated'
    }

    if (!docFileExists || entry.docCustomized !== true) {
      if (flags.oneOff) {
        const heading = extra.title || entry.title || basename(srcPath, ext)
        const blurb = String(extractBlurbText(content, entry.description).blurb ?? '').trim()
        const body = [
          `# ${heading}`,
          '',
          `> 一次性脚本：${flags.oneOffReason || '一次性使用'}。不生成完整文档，只保留说明；如需长期维护请改写为常驻脚本。`,
          '',
          blurb || '（脚本内未写作用说明；可在文件头加一行 `# 作用：一句话`）',
          '',
        ].join('\n')
        await writeFile(docPath, body, 'utf8')
      } else {
        await writeFile(docPath, docTemplate({ ...entry, logHint: logDir }), 'utf8')
      }
    } else if (flags.oneOff) {
      const currentDoc = await readFile(docPath, 'utf8').catch(() => '')
      if (currentDoc && !currentDoc.includes('一次性脚本')) {
        const lines = currentDoc.split('\n')
        const headIdx = lines.findIndex((line) => line.startsWith('# '))
        const marker = `> 一次性脚本：${flags.oneOffReason || '一次性使用'}。仅保留说明，不生成完整文档。`
        lines.splice(headIdx >= 0 ? headIdx + 1 : 0, 0, '', marker)
        await writeFile(docPath, lines.join('\n'), 'utf8')
      }
    }
    const docTitle = await readDocTitle(docPath)
    if (extra.title) entry.title = String(extra.title).slice(0, 80)
    else if (!entry.title && docTitle) entry.title = docTitle

    await saveIndex()
    return entry
  }

  // 脚本文件本身的创建时间（Windows 上取 birthtime，取不到回落 mtime）
  const fileTimeCache = new Map()
  async function fileCreatedAtOf(entry) {
    if (entry.fileCreatedAt) return entry.fileCreatedAt
    const key = entry.filePath
    if (!key) return null
    const cached = fileTimeCache.get(key)
    if (cached) return cached
    try {
      const stats = await stat(key)
      const ms = Number(stats.birthtimeMs) > 0 ? Number(stats.birthtimeMs) : Number(stats.mtimeMs)
      const iso = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
      if (iso) fileTimeCache.set(key, iso)
      return iso
    } catch {
      return null
    }
  }

  // 老条目没有固化创建时间：优先取源文件的 birthtime，源文件没了就用归档副本
  async function backfillFileTimes() {
    let changed = 0
    for (const entry of entries.values()) {
      if (entry.fileCreatedAt) continue
      let target = entry.filePath
      if (entry.srcPath && await stat(entry.srcPath).then((st) => st.isFile()).catch(() => false)) target = entry.srcPath
      try {
        const stats = await stat(target)
        const ms = Number(stats.birthtimeMs) > 0 ? Number(stats.birthtimeMs) : Number(stats.mtimeMs)
        if (!Number.isFinite(ms) || ms <= 0) continue
        entry.fileCreatedAt = new Date(ms).toISOString()
        changed += 1
      } catch {}
    }
    if (changed > 0) {
      await saveIndex()
      log('info', `backfilled fileCreatedAt for ${changed} entries`)
    }
    return changed
  }

  function statusSnapshot() {
    if (Date.now() - statusCache.at < 3000 && statusCache.map.size === entries.size) return statusCache.map
    statusCache.at = Date.now()
    statusCache.map = new Map()
    for (const entry of entries.values()) statusCache.map.set(entry.id, withStatus(entry))
    return statusCache.map
  }

  function withStatus(entry) {
    const state = runStateOf(entry)
    const startedAt = state.state === 'proc' ? state.startedAt : state.state === 'task' ? entry.lastRun?.startedAt : entry.lastRun?.startedAt
    const parsed = startedAt ? Date.parse(startedAt) : NaN
    const uptimeMs = state.running && Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0
    return {
      ...entry,
      running: state.running,
      runState: state.state,
      pid: state.state === 'proc' ? (state.pid ?? null) : state.state === 'running' ? (entry.lastRun?.pid ?? null) : null,
      procName: state.procName ?? '',
      uptimeMs,
      exitCode: entry.lastRun?.exitCode ?? null,
      exitedAt: entry.lastRun?.exitedAt ?? null,
      exitReason: entry.lastRun?.exitReason ?? '',
      task: state.task ?? '',
      taskStatus: state.taskStatus ?? '',
      taskRunning: state.state === 'task',
    }
  }

  function imageNameOf(pid) {
    const hit = procCache.get(pid)
    if (hit && Date.now() - hit.at < 15000) return hit.image
    let image = ''
    try {
      const out = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' })
      const line = String(out).split(/\r?\n/)[0] ?? ''
      const match = /^"([^"]+)"/.exec(line)
      image = match ? match[1].toLowerCase() : ''
    } catch {
      image = ''
    }
    procCache.set(pid, { image, at: Date.now() })
    return image
  }

  const PROC_LIST_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '\\.(ps1|psm1|py|js|mjs|cjs|cmd|bat|sh)\\b' } | ForEach-Object { [pscustomobject]@{ Id=$_.ProcessId; Name=$_.Name; Cmd=$_.CommandLine; At=$_.CreationDate } } | ConvertTo-Json -Compress -Depth 3"
  const PROC_SCRIPT_RE = /([^\\/\s"']+\.(?:ps1|psm1|py|js|mjs|cjs|cmd|bat|sh))\b/gi

  let procRefresh = null
  function parseProcList(stdout) {
    const parsed = JSON.parse(String(stdout).trim() || '[]')
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const rows = []
    const map = new Map()
    const self = process.pid
    for (const row of list) {
      if (!row || !Number.isInteger(row.Id) || row.Id === self) continue
      const cmd = String(row.Cmd ?? '')
      if (cmd.includes('Get-CimInstance')) continue
      const raw = String(row.At ?? '')
      const epoch = /\/Date\((\d+)\)\//.exec(raw)
      const item = {
        pid: row.Id,
        name: String(row.Name ?? ''),
        cmd,
        at: epoch ? new Date(Number(epoch[1])).toISOString() : raw,
      }
      rows.push(item)
      for (const hit of cmd.match(PROC_SCRIPT_RE) ?? []) {
        const key = hit.toLowerCase()
        if (map.has(key)) continue
        map.set(key, item)
      }
    }
    return { rows, map }
  }

  // 关键：请求线程绝不等 PowerShell；缓存过期就返回旧值并在后台刷新
  function kickProcRefresh() {
    if (procRefresh) return procRefresh
    procRefresh = new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROC_LIST_PS], {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 60000,
      }, (error, stdout) => {
        try {
          if (error) throw error
          const parsed = parseProcList(stdout)
          procList.rows = parsed.rows
          procList.map = parsed.map
          procList.at = Date.now()
        } catch (err) {
          log('warn', `process list failed: ${err?.message || err}`)
          procList.at = Date.now()
        } finally {
          procRefresh = null
          resolve()
        }
      })
    })
    return procRefresh
  }

  function procListRows() {
    if (Date.now() - procList.at > PROC_CACHE_TTL_MS) void kickProcRefresh()
    return procList.rows
  }

  function findByCmdline(entry) {
    const file = basename(entry.filePath).toLowerCase()
    if (!file) return null
    procListRows()
    return procList.map.get(file) ?? null
  }

  let portRefresh = null
  function kickPortRefresh() {
    if (portRefresh) return portRefresh
    portRefresh = new Promise((resolve) => {
      const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ports=@(${PROBE_HOSTS.map((item) => item.port).join(',')}); Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | ForEach-Object { [pscustomobject]@{ Port=$_.LocalPort; Pid=$_.OwningProcess; Name='' } } | ConvertTo-Json -Compress -Depth 3`
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 }, (error, stdout) => {
        const listen = new Map()
        try {
          if (error) throw error
          const parsed = JSON.parse(String(stdout).trim() || '[]')
          const list = Array.isArray(parsed) ? parsed : [parsed]
          for (const row of list) {
            if (row && Number.isInteger(row.Port) && !listen.has(row.Port)) listen.set(row.Port, row.Pid)
          }
        } catch (err) {
          log('warn', `port probe failed: ${err?.message || err}`)
        }
        const est = `(Get-NetTCPConnection -RemotePort 6199 -State Established -ErrorAction SilentlyContinue | Measure-Object).Count`
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', est], { windowsHide: true, encoding: 'utf8', timeout: 60000 }, (err2, out2) => {
          const established = err2 ? 0 : (Number(String(out2).trim()) || 0)
          portState.rows = PROBE_HOSTS.map((item) => {
            const pid = listen.get(item.port) ?? null
            let processName = ''
            if (pid) {
              try {
                processName = String(execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' })).split(/\r?\n/)[0]?.match(/^"([^"]+)"/)?.[1] ?? ''
              } catch {
                processName = ''
              }
            }
            return { port: item.port, label: item.label, listening: pid !== null, pid, process: processName, established: item.port === 6199 ? established : 0 }
          })
          portState.at = Date.now()
          portRefresh = null
          resolve()
        })
      })
    })
    return portRefresh
  }

  function probePorts() {
    if (Date.now() - portState.at > 5000) void kickPortRefresh()
    return portState.rows
  }

  const TASK_LIST_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ScheduledTask | ForEach-Object { $a = $_.Actions | Where-Object { $_.Execute } | Select-Object -First 1; [pscustomobject]@{ Name=$_.TaskName; State=[string]$_.State; Run=((($a.Execute, $a.Arguments) -join ' ').Trim()) } } | ConvertTo-Json -Compress -Depth 3"

  const vbsCache = new Map()

  function innerScriptsOfVbs(run) {
    const match = /([A-Za-z]:\\[^"]+?\.vbs)/i.exec(run)
    if (!match) return []
    const file = match[1].trim()
    const hit = vbsCache.get(file)
    if (hit && Date.now() - hit.at < TASK_CACHE_TTL_MS) return hit.names
    const names = []
    try {
      const text = readFileSync(file, 'utf8')
      const found = text.match(/([^\\/\s"']+\.(?:ps1|psm1|py|js|mjs|cjs|cmd|bat|sh))\b/gi) ?? []
      for (const name of found) {
        const key = name.toLowerCase()
        if (!names.includes(key)) names.push(key)
      }
    } catch {
      // VBS 读不到就退化成只认 .vbs
    }
    vbsCache.set(file, { names, at: Date.now() })
    return names
  }

  let taskIndexRefresh = null
  function buildTaskIndex(parsedJson) {
    const parsed = JSON.parse(String(parsedJson).trim() || '[]')
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const map = new Map()
    for (const task of list) {
      const run = String(task?.Run ?? '')
      if (!run) continue
      const match = /([^\\/\s"]+\.(?:ps1|psm1|py|js|mjs|cjs|cmd|bat|sh|vbs))\b/i.exec(run)
      if (!match) continue
      const key = match[1].toLowerCase()
      const name = String(task?.Name ?? '')
      if (!name) continue
      if (!map.has(key)) map.set(key, name)
      if (!taskStates.has(name)) taskStates.set(name, String(task?.State ?? ''))
      if (key.endsWith('.vbs')) {
        for (const inner of innerScriptsOfVbs(run)) {
          if (!map.has(inner)) map.set(inner, name)
        }
      }
    }
    return map
  }

  function kickTaskIndexRefresh() {
    if (taskIndexRefresh) return taskIndexRefresh
    taskIndexRefresh = new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', TASK_LIST_PS], { windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (error, stdout) => {
        try {
          if (error) throw error
          taskCache.map = buildTaskIndex(stdout)
          taskCache.at = Date.now()
          log('info', `scheduled tasks: ${taskCache.map.size} scripts mapped`)
        } catch (err) {
          log('warn', `scheduled task index failed: ${err?.message || err}`)
          taskCache.at = Date.now()
        } finally {
          taskIndexRefresh = null
          resolve()
        }
      })
    })
    return taskIndexRefresh
  }

  function taskIndex() {
    if (Date.now() - taskCache.at > TASK_CACHE_TTL_MS) void kickTaskIndexRefresh()
    return taskCache.map
  }

  function taskOf(entry) {
    const map = taskIndex()
    if (map.size === 0) return ''
    const key = basename(entry.filePath).toLowerCase()
    return map.get(key) ?? ''
  }

  const TASK_STATE_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ScheduledTask | ForEach-Object { [pscustomobject]@{ Name=$_.TaskName; State=[string]$_.State } } | ConvertTo-Json -Compress -Depth 2"

  let taskStateRefresh = null
  function kickTaskStateRefresh() {
    if (taskStateRefresh) return taskStateRefresh
    taskStateRefresh = new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', TASK_STATE_PS], { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 }, (error, stdout) => {
        try {
          if (error) throw error
          const parsed = JSON.parse(String(stdout).trim() || '[]')
          const list = Array.isArray(parsed) ? parsed : [parsed]
          const map = new Map()
          for (const row of list) {
            const name = String(row?.Name ?? '')
            if (name) map.set(name, String(row?.State ?? ''))
          }
          taskStateBulk.map = map
          taskStateBulk.at = Date.now()
        } catch (err) {
          log('warn', `scheduled task state refresh failed: ${err?.message || err}`)
          taskStateBulk.at = Date.now()
        } finally {
          taskStateRefresh = null
          resolve()
        }
      })
    })
    return taskStateRefresh
  }

  function refreshTaskStates() {
    if (Date.now() - taskStateBulk.at > TASK_STATE_TTL_MS) void kickTaskStateRefresh()
    return taskStateBulk.map
  }

  function taskStatusOf(task) {
    if (!task) return ''
    const map = refreshTaskStates()
    const status = map.get(task)
    if (status) {
      taskStates.set(task, status)
      return status
    }
    return taskStates.get(task) ?? ''
  }

  function runStateOf(entry) {
    const pid = entry.lastRun?.pid
    const task = taskOf(entry)
    const taskStatus = task ? taskStatusOf(task) : ''
    const taskRunning = TASK_RUNNING.test(taskStatus)
    if (!Number.isInteger(pid) || pid <= 0) {
      if (taskRunning) return { running: true, state: 'task', task, taskStatus }
      const proc = findByCmdline(entry)
      if (proc) return { running: true, state: 'proc', task, taskStatus, pid: proc.pid, startedAt: proc.at, procName: proc.name }
      return { running: false, state: task ? 'task-idle' : 'idle', task, taskStatus }
    }
    const child = children.get(entry.id)
    if (child && child.exitCode === null) return { running: true, state: 'running', task, taskStatus }
    if (!isAlive(pid)) {
      procCache.delete(pid)
      if (taskRunning) return { running: true, state: 'task', task, taskStatus }
      const proc = findByCmdline(entry)
      if (proc) return { running: true, state: 'proc', task, taskStatus, pid: proc.pid, startedAt: proc.at, procName: proc.name }
      return { running: false, state: 'exited', task, taskStatus }
    }
    const image = imageNameOf(pid)
    if (image === '') return { running: true, state: 'running', task, taskStatus }
    const hints = IMAGE_HINTS[String(entry.ext ?? '').toLowerCase()] ?? []
    const matched = hints.length === 0 || hints.some((hint) => image.includes(hint))
    if (matched) return { running: true, state: 'running', task, taskStatus }
    const proc = findByCmdline(entry)
    if (proc) return { running: true, state: 'proc', task, taskStatus, pid: proc.pid, startedAt: proc.at, procName: proc.name }
    return taskRunning ? { running: true, state: 'task', task, taskStatus } : { running: false, state: 'reused', task, taskStatus }
  }

  async function reconcileRuns() {
    let changed = 0
    for (const entry of entries.values()) {
      const pid = entry.lastRun?.pid
      if (!Number.isInteger(pid) || pid <= 0) continue
      if (entry.lastRun?.exitedAt) continue
      const state = runStateOf(entry)
      if (state.running) continue
      entry.lastRun = {
        ...(entry.lastRun ?? {}),
        exitedAt: nowISO(),
        exitReason: state.state === 'reused' ? 'pid 已被其他进程复用' : '进程已结束（外部停止或崩溃）',
      }
      procCache.delete(pid)
      changed += 1
      log('info', `status ${entry.name}: exited reason=${entry.lastRun.exitReason}`)
    }
    if (changed > 0) await saveIndex()
    lastRunCheckAt = nowISO()
    statusCache.at = 0
    return changed
  }

  async function startEntry(id) {
    await loadIndex()
    const entry = entries.get(id)
    if (!entry) throw new Error(`unknown entry: ${id}`)
    if (runStateOf(entry).running) return withStatus(entry)
    const command = runCommand(entry, config)
    if (!command) throw new Error(`unsupported extension: ${entry.ext}`)
    if (entry.ext.toLowerCase() === '.ps1' || entry.ext.toLowerCase() === '.psm1') ensurePsBom(entry.filePath)

    await mkdir(logDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logPath = join(logDir, `${entry.slug}-${stamp}.log`)
    const stream = createWriteStream(logPath, { flags: 'a' })
    const child = spawn(command.cmd, command.args, {
      cwd: dirname(entry.filePath),
      detached: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.pipe(stream)
    child.stderr?.pipe(stream)
    child.on('error', (error) => log('warn', `spawn ${entry.name} failed: ${error.message}`))
    child.on('close', (code) => {
      stream.end()
      logStreams.delete(entry.id)
      children.delete(entry.id)
      procCache.delete(child.pid)
      entry.lastRun = { ...(entry.lastRun ?? {}), exitCode: code ?? null, exitedAt: nowISO(), exitReason: `进程退出 code=${code}` }
      saveIndex().catch(() => {})
      log('info', `${entry.name} exited code=${code}`)
    })
    child.unref()
    logStreams.set(entry.id, stream)
    children.set(entry.id, child)

    entry.lastRun = { pid: child.pid, startedAt: nowISO(), logPath, command: [command.cmd, ...command.args].join(' ') }
    entry.runCount = (entry.runCount ?? 0) + 1
    statusCache.at = 0
    await saveIndex()
    log('info', `started ${entry.name} pid=${child.pid}`)
    return withStatus(entry)
  }

  async function stopEntry(id) {
    await loadIndex()
    const entry = entries.get(id)
    if (!entry) throw new Error(`unknown entry: ${id}`)
    const pid = entry.lastRun?.pid
    if (!isAlive(pid)) {
      entry.lastRun = { ...(entry.lastRun ?? {}), stoppedAt: nowISO(), exitedAt: entry.lastRun?.exitedAt ?? nowISO(), exitReason: entry.lastRun?.exitReason || '进程已不在运行' }
      await saveIndex()
      return withStatus(entry)
    }
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      log('warn', `taskkill failed: ${error.message}`)
    }
    entry.lastRun = { ...(entry.lastRun ?? {}), stoppedAt: nowISO(), exitedAt: nowISO(), exitReason: '手动停止' }
    statusCache.at = 0
    await saveIndex()
    return withStatus(entry)
  }

  async function deleteEntry(id) {
    await loadIndex()
    const entry = entries.get(id)
    if (!entry) throw new Error(`unknown entry: ${id}`)
    if (runStateOf(entry).running) await stopEntry(id)
    const { rm } = await import('node:fs/promises')
    const inside = (target) => typeof target === 'string' && target.startsWith(root + sep)
    if (!inside(entry.filePath) || !inside(entry.docPath)) throw new Error('refuse to delete outside archive root')
    await rm(entry.filePath, { force: true }).catch(() => {})
    await rm(entry.docPath, { force: true }).catch(() => {})
    entries.delete(id)
    await saveIndex()
    return entry
  }

  async function tailLog(entry, lines) {
    const logPath = entry.lastRun?.logPath
    if (!logPath) return ''
    const text = await readFile(logPath, 'utf8').catch(() => '')
    const rows = text.split(/\r?\n/)
    return rows.slice(Math.max(0, rows.length - lines)).join('\n')
  }

  async function readDoc(entry) {
    return readFile(entry.docPath, 'utf8').catch(() => '')
  }

  // ---- routes -------------------------------------------------------------
  // ---- import from history ------------------------------------------------
  let aiLogPath = null

  function sessionStoreBase() {
    const home = process.env.USERPROFILE ?? 'C:\\Users\\Administrator'
    return join(home, '.dsh', 'sessions')
  }

  let sessionListAll = []

  async function collectSessionCwds() {
    const base = sessionStoreBase()
    const out = new Map()
    sessionListAll = []
    const consider = async (dir) => {
      const file = join(dir, 'session.v4.jsonl.zstd')
      let header = null
      try {
        const text = zstdDecompressSync(await readFile(file)).toString('utf8')
        header = JSON.parse(text.split('\n').find((line) => line.trim() !== '') ?? '{}')
      } catch {
        return
      }
      const cwd = typeof header?.cwd === 'string' ? resolve(header.cwd) : ''
      if (cwd === '') return
      const at = Number(header.createdAt ?? 0)
      sessionListAll.push({ cwd, at, id: String(header.id ?? basename(dir)), parent: header.parentSession ?? null })
      const prev = out.get(cwd)
      if (!prev || at > prev.at) {
        out.set(cwd, { cwd, at, id: String(header.id ?? basename(dir)), parent: header.parentSession ?? null })
      }
    }
    let level1 = []
    try {
      level1 = await readdir(base, { withFileTypes: true })
    } catch {
      return out
    }
    for (const dirent of level1.slice(0, 100)) {
      if (!dirent.isDirectory()) continue
      const dirPath = join(base, dirent.name)
      await consider(dirPath)
      let level2 = []
      try {
        level2 = await readdir(dirPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of level2.slice(0, 400)) {
        if (!child.isDirectory()) continue
        await consider(join(dirPath, child.name))
      }
    }
    return out
  }

  const sessionTitleFileCache = new Map()
  const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

  function fileStamp(file) {
    try {
      const info = statSync(file)
      return `${info.size}:${Math.floor(info.mtimeMs)}`
    } catch {
      return ''
    }
  }

  async function readSessionTitle(file) {
    const stamp = fileStamp(file)
    if (!stamp) return null
    const hit = sessionTitleFileCache.get(file)
    if (hit && hit.stamp === stamp) return hit.title
    let title = null
    try {
      const size = Number(stamp.split(':')[0])
      const window = Math.min(size, 2 * 1024 * 1024)
      const buf = Buffer.alloc(window)
      let fh = null
      try {
        fh = openSync(file, 'r')
        readSync(fh, buf, 0, window, size - window)
      } finally {
        if (fh !== null) closeSync(fh)
      }
      const starts = []
      let cursor = buf.indexOf(ZSTD_MAGIC)
      while (cursor !== -1) {
        starts.push(cursor)
        cursor = buf.indexOf(ZSTD_MAGIC, cursor + 4)
      }
      let scanned = 0
      for (let i = starts.length - 1; i >= 0 && scanned < 200; i -= 1, scanned += 1) {
        const begin = starts[i]
        const stop = i + 1 < starts.length ? starts[i + 1] : buf.length
        let text = ''
        try {
          text = zstdDecompressSync(buf.subarray(begin, stop)).toString('utf8')
        } catch {
          continue
        }
        let found = null
        for (const line of text.split('\n')) {
          if (!line.includes('"session/title"')) continue
          try {
            const record = JSON.parse(line)
            const value = record?.data?.title
            if (typeof value === 'string' && value.trim() !== '') found = value.trim().replace(/^"|"$/g, '').trim()
          } catch {
            // ignore malformed frame line
          }
        }
        if (found) { title = found; break }
      }
    } catch {
      title = null
    }
    sessionTitleFileCache.set(file, { stamp, title })
    return title
  }

  let sessionTitleCache = { at: 0, map: new Map() }
  async function sessionTitleMap() {
    const ttl = 60 * 1000
    if (Date.now() - sessionTitleCache.at < ttl) return sessionTitleCache.map
    const map = new Map()
    const base = sessionStoreBase()
    const visit = async (dir) => {
      const title = await readSessionTitle(join(dir, 'session.v4.jsonl.zstd'))
      if (!title) return
      const dirName = basename(dir)
      map.set(dirName, title)
      map.set(dirName.replace(/^session-/, ''), title)
    }
    let level1 = []
    try {
      level1 = await readdir(base, { withFileTypes: true })
    } catch {
      return map
    }
    for (const dirent of level1.slice(0, 100)) {
      if (!dirent.isDirectory()) continue
      const dirPath = join(base, dirent.name)
      await visit(dirPath)
      let level2 = []
      try {
        level2 = await readdir(dirPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of level2.slice(0, 400)) {
        if (child.isDirectory()) await visit(join(dirPath, child.name))
      }
    }
    sessionTitleCache = { at: Date.now(), map }
    return map
  }

  function sessionTitleFor(entry, titles) {
    if (entry.sessionTitle) return entry.sessionTitle
    const raw = String(entry.sessionId ?? entry.session ?? '')
    if (raw === '') return null
    if (titles.has(raw)) return titles.get(raw)
    const short = raw.replace(/^session-/, '')
    if (titles.has(short)) return titles.get(short)
    const shortMatch = /([0-9a-f]{8})/i.exec(short)
    if (shortMatch) {
      for (const [key, value] of titles) if (key.includes(shortMatch[1])) return value
    }
    return null
  }

  function frameStarts(buf) {
    const starts = []
    for (let i = 0; i + 4 <= buf.length; i += 1) {
      if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i)
    }
    return starts
  }

  const normTitle = (value) => String(value ?? '').replace(/["“”'’\s]/g, '').trim()

  let titleFileCache = { at: 0, map: new Map() }

  async function sessionFilesByTitle() {
    const ttl = 60 * 1000
    if (Date.now() - titleFileCache.at < ttl) return titleFileCache.map
    const base = sessionStoreBase()
    const map = new Map()
    const dirs = []
    const level1 = await readdir(base, { withFileTypes: true }).catch(() => [])
    for (const dirent of level1.slice(0, 100)) {
      if (!dirent.isDirectory()) continue
      const dirPath = join(base, dirent.name)
      dirs.push(dirPath)
      const level2 = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
      for (const child of level2.slice(0, 400)) {
        if (child.isDirectory()) dirs.push(join(dirPath, child.name))
      }
    }
    for (const dir of dirs) {
      const file = join(dir, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      const title = await readSessionTitle(file)
      if (title) {
        map.set(title, file)
        map.set(normTitle(title), file)
      }
    }
    titleFileCache = { at: Date.now(), map }
    return map
  }

  const digestCache = new Map()

  async function findSessionFile(key) {
    const wanted = String(key ?? '').replace(/^session-/, '').trim()
    if (wanted === '') return null
    const base = sessionStoreBase()
    const dirs = []
    const level1 = await readdir(base, { withFileTypes: true }).catch(() => [])
    for (const dirent of level1.slice(0, 100)) {
      if (!dirent.isDirectory()) continue
      const dirPath = join(base, dirent.name)
      dirs.push(dirPath)
      const level2 = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
      for (const child of level2.slice(0, 400)) {
        if (child.isDirectory()) dirs.push(join(dirPath, child.name))
      }
    }
    let best = null
    for (const dir of dirs) {
      const file = join(dir, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      const name = basename(dir).replace(/^session-/, '')
      let score = 0
      if (name === wanted) score = 3
      else if (name.startsWith(wanted) || wanted.startsWith(name)) score = 2
      else if (name.includes(wanted)) score = 1
      if (score === 0) continue
      if (!best || score > best.score) best = { score, file }
    }
    if (best) return best.file
    const byTitle = await sessionFilesByTitle()
    const keyNorm = normTitle(key)
    if (byTitle.has(key)) return byTitle.get(key)
    if (keyNorm !== '' && byTitle.has(keyNorm)) return byTitle.get(keyNorm)
    for (const [title, file] of byTitle) {
      const titleNorm = normTitle(title)
      if (titleNorm === '' || keyNorm === '') continue
      if (titleNorm.includes(keyNorm) || keyNorm.includes(titleNorm)) return file
    }
    return null
  }

  function messageText(record) {
    const parts = Array.isArray(record?.data?.content) ? record.data.content : []
    const texts = []
    for (const part of parts) {
      if (part && part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    }
    return texts.join('\n').trim()
  }

  function isNoiseMessage(text) {
    if (text.length < 4) return true
    if (text.startsWith('Current runtime context.')) return true
    if (text.startsWith('<system-reminder>')) return true
    if (text.startsWith('The approval policy changed')) return true
    if (text.startsWith('[Compressed conversation section]')) return true
    return false
  }

  async function readSessionDigest(file, maxChars = 2600) {
    const buf = await readFile(file)
    const starts = frameStarts(buf)
    const parts = []
    let total = 0
    outer: for (let i = 0; i < starts.length; i += 1) {
      const stop = i + 1 < starts.length ? starts[i + 1] : buf.length
      let text = ''
      try {
        text = zstdDecompressSync(buf.subarray(starts[i], stop)).toString('utf8')
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) continue
        if (!trimmed.includes('"user/message"') && !trimmed.includes('"assistant/message"')) continue
        let record = null
        try {
          record = JSON.parse(trimmed)
        } catch {
          continue
        }
        const type = record?.type
        if (type !== 'user/message' && type !== 'assistant/message') continue
        const body = messageText(record)
        if (body === '' || isNoiseMessage(body)) continue
        const role = type === 'user/message' ? '用户' : '助手'
        const limit = role === '用户' ? 360 : 200
        const clipped = body.length > limit ? body.slice(0, limit) + '…' : body
        parts.push('[' + role + '] ' + clipped)
        total += clipped.length
        if (total >= maxChars) break outer
      }
    }
    return parts.join('\n')
  }

  async function sessionDigestForEntry(entry, maxChars = 1200) {
    const key = entry.sessionId || entry.session || entry.sessionTitle || ''
    if (key === '') return ''
    const file = await findSessionFile(key)
    if (!file) return ''
    const cacheKey = file + '::' + maxChars
    const cached = digestCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.text
    try {
      const text = await readSessionDigest(file, maxChars)
      digestCache.set(cacheKey, { at: Date.now(), text })
      return text
    } catch {
      return ''
    }
  }

  async function sessionDigestForKeys(idOrSession) {
    const raw = String(idOrSession ?? '').trim()
    if (raw === '') return ''
    await loadIndex()
    const entry = entries.get(raw)
    if (entry) return await sessionDigestForEntry(entry, 6000)
    const file = await findSessionFile(raw)
    if (!file) return ''
    try {
      return await readSessionDigest(file, 6000)
    } catch {
      return ''
    }
  }

  async function digestForLog(targets) {
    const digests = await digestsForTargets(targets, 1200)
    let total = 0
    let hit = 0
    for (const text of digests.values()) {
      const length = String(text ?? '').length
      total += length
      if (length > 0) hit += 1
    }
    aiLog('digests ' + hit + '/' + targets.length + ' targets, ' + total + ' chars')
    return digests
  }

  async function digestsForTargets(targets, maxChars) {
    const map = new Map()
    for (const target of targets) {
      const digest = await sessionDigestForEntry(target, maxChars)
      if (digest !== '') map.set(target.id, digest)
    }
    return map
  }

  const docQualityCache = new Map()

  async function docQualityOf(entry) {
    let stats = null
    try {
      stats = statSync(entry.docPath)
    } catch {
      return { docState: 'missing', docChars: 0, docReason: '文档不存在' }
    }
    const cacheKey = entry.docPath + '::' + stats.mtimeMs
    const cached = docQualityCache.get(cacheKey)
    if (cached) return cached
    let text = ''
    try {
      text = await readFile(entry.docPath, 'utf8')
    } catch {
      return { docState: 'missing', docChars: 0, docReason: '文档不可读' }
    }
    let body = ''
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('|') || trimmed.startsWith('>')) continue
      body += trimmed
    }
    const chars = body.replace(/\s/g, '').length
    let docState = 'ok'
    let docReason = ''
    if (/一次性脚本/.test(text) && chars < 120) {
      docState = 'ok'
      docReason = ''
    } else if (/可在所属会话内让 AI 补写|文档状态 \| 骨架模板|填写模板/.test(text)) {
      docState = 'skeleton'
      docReason = '仍是骨架模板'
    } else if (chars < 80) {
      docState = 'thin'
      docReason = '正文不足 80 字'
    } else if (/（待补充|待填写|TODO/.test(text)) {
      docState = 'thin'
      docReason = '含待补充占位'
    }
    const result = { docState, docChars: chars, docReason }
    docQualityCache.set(cacheKey, result)
    return result
  }

  async function readDocTitle(docPath) {
    let stamp = ''
    try {
      stamp = String(statSync(docPath).mtimeMs)
    } catch {
      stamp = ''
    }
    if (!stamp) return null
    const hit = docTitleCache.get(docPath)
    if (hit && hit.stamp === stamp) return hit.title
    let title = null
    try {
      const text = await readFile(docPath, 'utf8')
      const match = /^#\s+(.+)$/m.exec(text)
      title = match ? match[1].trim() : null
    } catch {
      title = null
    }
    docTitleCache.set(docPath, { stamp, title })
    return title
  }

  async function setHidden(id, hidden) {
    await loadIndex()
    const entry = entries.get(id)
    if (!entry) throw new Error('unknown entry: ' + id)
    if (hidden) entry.hidden = true
    else delete entry.hidden
    entry.updatedAt = nowISO()
    await saveIndex()
    return entry
  }

  // 点击认领：记录首次点击时间，面板据此在 24 小时后摘掉 NEW 徽标
  async function markSeen(id) {
    await loadIndex()
    const entry = entries.get(String(id ?? ''))
    if (!entry) throw new Error(`unknown script id: ${id}`)
    if (!entry.seenAt) {
      entry.seenAt = nowISO()
      await saveIndex()
    }
    return entry
  }

  async function renameEntry(id, rawTitle) {
    await loadIndex()
    const entry = entries.get(id)
    if (!entry) throw new Error('unknown entry: ' + id)
    const title = String(rawTitle ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
    if (title === '') throw new Error('title is required')
    entry.title = title
    entry.titleSource = 'manual'
    entry.updatedAt = nowISO()
    try {
      let text = await readFile(entry.docPath, 'utf8')
      text = /^#\s+.*$/m.test(text) ? text.replace(/^#\s+.*$/m, '# ' + title) : '# ' + title + '\n\n' + text
      await writeFile(entry.docPath, text, 'utf8')
    } catch {
      // doc missing: title still applies to the panel
    }
    await saveIndex()
    return entry
  }

  async function listScriptsIn(dir, depth = 0) {
    const found = []
    if (depth > 3) return found
    let dirents = []
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return found
    }
    for (const dirent of dirents) {
      if (found.length > 400) break
      const full = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(dirent.name) || dirent.name.startsWith('.')) continue
        found.push(...(await listScriptsIn(full, depth + 1)))
        continue
      }
      if (!dirent.isFile()) continue
      if (!SCRIPT_EXTS.has(extname(dirent.name).toLowerCase())) continue
      try {
        const info = await stat(full)
        if (info.size > 2 * 1024 * 1024) continue
        found.push({ path: full, dir, name: dirent.name, size: info.size, mtime: info.mtimeMs })
      } catch {
        // ignore unreadable files
      }
    }
    return found
  }

  function firstSegment(value) {
    return String(value ?? '').split('/')[0].trim()
  }

  function resolveCandidateSession(entry, sessionsForFile, titles) {
    const legacy = /^会话 ([0-9a-f]{8})$/i.exec(String(entry?.session ?? ''))
    if (legacy) {
      const resolved = sessionTitleFor({ sessionId: legacy[1] }, titles)
      if (resolved) return firstSegment(resolved)
    }
    if (entry?.session && !legacy) return firstSegment(entry.session)
    if (entry?.sessionTitle) return firstSegment(entry.sessionTitle)
    for (const item of sessionsForFile) {
      const resolved = sessionTitleFor({ sessionId: item.id }, titles)
      if (resolved) return firstSegment(resolved)
    }
    return sessionsForFile.length > 0 ? '未命名会话' : '未标注'
  }

  async function readHead(filePath, limit = 16384) {
    try {
      const handle = await openFile(filePath, 'r')
      const buffer = Buffer.alloc(limit)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      await handle.close()
      return buffer.subarray(0, bytesRead).toString('utf8')
    } catch {
      return ''
    }
  }

  async function scanImportSources() {
    await loadIndex()
    const sessions = await collectSessionCwds()
    const titlesMap = await sessionTitleMap()
    const dirs = new Set([...watchDirs.map((dir) => resolve(dir)), ...sessions.keys()].filter((dir) => dir !== root && !dir.startsWith(root + sep)))
    const candidates = []
    for (const dir of dirs) {
      const files = await listScriptsIn(dir)
      const dirSessions = sessionListAll.filter((item) => item.cwd === dir).sort((a, b) => a.at - b.at)
      const pickSessions = (mtimeMs) => {
        const earlier = dirSessions.filter((item) => item.at <= mtimeMs)
        const ordered = earlier.length > 0 ? earlier : dirSessions
        return [...ordered].reverse()
      }
      for (const file of files) {
        if (file.path === root || file.path.startsWith(root + sep)) continue
        const id = sha1(file.path).slice(0, 12)
        const entry = entries.get(id)
        const siblingDoc = join(dir, basename(file.name, extname(file.name)) + '.md')
        const docTitle = (await readDocTitle(join(dir, basename(file.name, extname(file.name)) + '.md'))) || (entry ? await readDocTitle(entry.docPath) : null)
        const baseName = basename(file.name, extname(file.name))
        const sessionsForFile = pickSessions(file.mtime)
        const headText = await readHead(file.path)
        const oneOffFlags = classifyEntry(file.name, extname(file.name), file.path, headText)
        candidates.push({
          key: id,
          name: file.name,
          title: docTitle || entry?.title || null,
          displayName: docTitle || entry?.title || baseName,
          needsName: !(docTitle || entry?.title),
          docPath: entry?.docPath ?? (await stat(siblingDoc).then(() => siblingDoc).catch(() => null)),
          path: file.path,
          dir,
          size: file.size,
          mtime: new Date(file.mtime).toISOString(),
          session: resolveCandidateSession(entry, sessionsForFile, titlesMap),
          sessionId: sessionsForFile[0]?.id ?? null,
          archived: Boolean(entry),
          docCustomized: Boolean(entry?.docCustomized),
          importance: entry?.importance ?? null,
          oneOff: oneOffFlags.oneOff,
          oneOffReason: oneOffFlags.oneOffReason,
          backup: oneOffFlags.backup,
          backupReason: oneOffFlags.backupReason,
          stale: oneOffFlags.stale,
          staleReason: oneOffFlags.staleReason,
        })
      }
    }
    const byBase = new Map()
    for (const item of candidates) {
      const baseKey = `${item.dir}|${basename(item.name, extname(item.name)).toLowerCase().replace(/[-_.]v(\d+)(?:\.\d+)*$/, '').replace(/[-_.](bak|backup|copy|old|legacy|副本|备份)$/, '')}`
      if (!byBase.has(baseKey)) byBase.set(baseKey, [])
      byBase.get(baseKey).push(item)
    }
    for (const items of byBase.values()) {
      const pool = items.filter((item) => !BACKUP_NAME.test(item.name))
      if (pool.length < 2) continue
      const newest = pool.reduce((a, b) => (b.mtime > a.mtime ? b : a))
      for (const item of pool) {
        if (item === newest) continue
        item.stale = true
        item.staleReason = item.staleReason ? `${item.staleReason}；同名脚本的较旧版本` : '同名脚本的较旧版本'
      }
    }
    candidates.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
    return { roots: [...dirs], candidates }
  }

  async function importEntries(keys, options = {}) {
    const scanned = await scanImportSources()
    const byKey = new Map(scanned.candidates.map((item) => [item.key, item]))
    const results = []
    for (const key of keys) {
      const target = byKey.get(key)
      if (!target) {
        results.push({ key, ok: false, error: 'candidate not found' })
        continue
      }
      try {
        const entry = await archiveFile(target.path, {
          session: options.session ?? target.session,
          sessionId: target.sessionId ?? '',
          description: options.description ?? '',
          title: target.title ?? undefined,
          fresh: false,
        })
        results.push({
          key,
          ok: true,
          id: entry.id,
          name: entry.name,
          title: entry.title ?? null,
          needsName: !entry.title,
          docPath: entry.docPath,
          session: entry.session,
        })
      } catch (error) {
        results.push({ key, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    await applyAutoTitles()
    if (options.ai === true) {
      await markAiPending(results)
    }
    return results
  }

  function aiLog(line) {
    try {
      if (aiLogPath === null) aiLogPath = join(logDir, 'import-ai.log')
      mkdirSync(logDir, { recursive: true })
      appendFileSync(aiLogPath, `${nowISO()} ${line}\n`)
    } catch {
      // logging is best-effort
    }
  }

  async function markAiPending(results) {
    await loadIndex()
    for (const item of results) {
      if (!item.ok) continue
      const entry = entries.get(item.id)
      if (!entry) continue
      entry.aiDoc = 'pending'
      entry.aiDocAt = nowISO()
      entry.aiDocReason = entry.title ? 'doc' : 'doc+name'
      aiLog(`queued ${entry.name} (${entry.aiDocReason}) -> ${entry.docPath}`)
    }
    await saveIndex()
  }

  function pendingDocs() {
    return [...entries.values()]
      .filter((entry) => entry.aiDoc === 'pending' || entry.aiDoc === 'running')
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        title: entry.title ?? null,
        reason: entry.aiDocReason ?? 'doc',
        session: entry.session,
        category: entry.category,
        project: entry.project,
        filePath: entry.filePath,
        docPath: entry.docPath,
        state: entry.aiDoc,
      }))
  }

  const aiRun = { active: false, sessionId: '', total: 0, startedAt: '', finishedAt: '', error: '', targets: [] }

  async function aiTargets(ids) {
    const wanted = new Set((ids ?? []).map((value) => String(value)))
    const pool = []
    for (const entry of entries.values()) {
      if (wanted.size > 0) {
        if (wanted.has(entry.id)) pool.push(entry)
        continue
      }
      if (entry.aiDoc === 'pending') {
        pool.push(entry)
        continue
      }
      const quality = await docQualityOf(entry)
      if (quality.docState === 'missing' || quality.docState === 'skeleton' || quality.docState === 'thin') pool.push(entry)
    }
    return pool.slice(0, 200)
  }

  function aiPromptFor(targets, digests = new Map()) {
    const lines = targets.map((entry, index) => {
      const head = `${index + 1}. id=${entry.id}；文件=${entry.filePath}；类别=${entry.category}；项目=${entry.project}；会话=${entry.session || '未标注'}；标题=${entry.title || entry.name}`
      const digest = digests.get(entry.id)
      return digest ? head + '\n   会话摘要：' + digest : head
    })
    return [
      '你是「脚本中心」的补文档助手，只做文档与重要性补写，不修改脚本内容、不启动脚本。',
      '需要处理的脚本：',
      ...lines,
      '',
      '对每个脚本依次执行：',
      '1) 用 read 工具读取脚本文件，理解它做什么、怎么用；',
      '2) 调用工具 script_hub，参数 action=doc_save、id=<上面的 id>、doc=<完整 Markdown>；文档结构固定为：一级标题（脚本显示名）、## 作用、## 运行方式、## 参数与输入输出、## 依赖、## 注意事项、## 变更记录，全文中文、40 行以内、不要编造不存在的参数；',
      '3) 若该脚本还没有重要性（面板「重要」列为空），再调用 script_hub，参数 action=importance_save、id=<id>、level=high|medium|low、description=<20 字以内理由>。',
      '脚本清单里带了「会话摘要」；需要更多上下文时，可调用 script_hub 的 {action:"session_context", id:"<脚本 id>"} 读取该脚本所属会话的历史对话全文摘要，再据此写文档。',
      '全部完成后用 3 行以内中文说明处理了哪些脚本、哪些失败。',
    ].join('\n')
  }

  const AI_DOC_BATCH = 10
  const AI_DOC_BATCH_TIMEOUT_MS = 20 * 60 * 1000

  async function startAiDocs(ids) {
    await loadIndex()
    if (aiRun.active) throw new Error('已有补全任务在运行，请等待完成')
    const targets = await aiTargets(ids)
    if (targets.length === 0) throw new Error('没有需要补全文档的脚本')
    aiRun.active = true
    aiRun.sessionId = ''
    aiRun.batchSessions = []
    aiRun.total = targets.length
    aiRun.startedAt = nowISO()
    aiRun.finishedAt = ''
    aiRun.error = ''
    aiRun.startedMs = Date.now()
    aiRun.targets = targets.map((entry) => ({ id: entry.id, name: entry.name, docPath: entry.docPath }))
    aiLog('ai-run start targets=' + targets.length + ' batches=' + Math.ceil(targets.length / AI_DOC_BATCH))
    void (async () => {
      try {
        for (let offset = 0; offset < targets.length; offset += AI_DOC_BATCH) {
          const batch = targets.slice(offset, offset + AI_DOC_BATCH)
          const batchStartMs = Date.now()
          const digests = await digestForLog(batch)
          const created = await ctx.sessionController.create({ cwd: root })
          const sessionId = created.sessionId
          if (!aiRun.sessionId) aiRun.sessionId = sessionId
          aiRun.batchSessions.push(sessionId)
          aiLog('ai-run batch ' + (offset + 1) + '-' + (offset + batch.length) + ' session ' + sessionId)
          await ctx.sessionController.prompt({
            requestId: randomUUID(),
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: aiPromptFor(batch, digests) }],
            clientTimeZone: 'Asia/Shanghai',
          }, new AbortController().signal)
          const deadline = Date.now() + AI_DOC_BATCH_TIMEOUT_MS
          let fresh = 0
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 3000))
            let next = 0
            for (const target of batch) {
              try {
                if (statSync(target.docPath).mtimeMs >= batchStartMs - 1000) next += 1
              } catch {
                // still missing
              }
            }
            if (next !== fresh) {
              fresh = next
              aiLog('ai-run progress ' + (offset + fresh) + '/' + targets.length + ' (batch ' + (Math.floor(offset / AI_DOC_BATCH) + 1) + '/' + Math.ceil(targets.length / AI_DOC_BATCH) + ')')
            }
            if (fresh >= batch.length) break
          }
          if (fresh < batch.length) {
            aiRun.error = '第 ' + (Math.floor(offset / AI_DOC_BATCH) + 1) + ' 批（' + batch.length + ' 个）在 20 分钟内未全部写入文档，已停止后续批次'
            break
          }
        }
      } catch (error) {
        aiRun.error = String(error?.message || error)
        aiLog('ai-run failed: ' + aiRun.error)
      } finally {
        await loadIndex()
        for (const target of aiRun.targets) {
          const entry = entries.get(target.id)
          if (!entry) continue
          try {
            statSync(entry.docPath)
          } catch {
            continue
          }
          const quality = await docQualityOf(entry)
          if (quality.docState === 'ok') {
            entry.aiDoc = 'done'
            entry.docCustomized = true
            entry.docState = 'ok'
            entry.docReason = ''
          } else {
            entry.aiDoc = 'pending'
            entry.docCustomized = false
            entry.docState = quality.docState
            entry.docReason = quality.docReason
          }
        }
        await saveIndex()
        aiRun.active = false
        aiRun.finishedAt = nowISO()
        aiLog('ai-run finished done=' + aiRunDone() + ' error=' + (aiRun.error || '-'))
        try {
          const archived = await archiveGeneratedSessions('doc', aiRun.batchSessions, aiRun.total, aiRun.startedMs)
          aiLog('session-archive kind=doc sessions=' + archived.records.length + ' products=' + archived.products + ' transcripts=' + archived.transcripts + ' archived=' + archived.archived)
        } catch (error) {
          aiLog('session-archive failed: ' + (error?.message || error))
        }
      }
    })()
    return { total: targets.length, batches: Math.ceil(targets.length / AI_DOC_BATCH) }
  }

  function aiRunDone() {
    if (!aiRun.targets.length) return 0
    const since = aiRun.startedMs ?? 0
    let done = 0
    for (const target of aiRun.targets) {
      try {
        const stat = statSync(target.docPath)
        if (stat.mtimeMs >= since) done += 1
      } catch {
        // not written yet
      }
    }
    return done
  }

  const IMPORTANCE_LABEL = { high: '高', medium: '中', low: '低', pending: '待检测' }

  function importanceEntries() {
    return [...entries.values()].filter((entry) => entry.importance === 'pending' || entry.importance === 'high' || entry.importance === 'medium' || entry.importance === 'low')
  }

  async function queueImportance(keys) {
    await loadIndex()
    const queued = []
    for (const key of keys) {
      const entry = entries.get(String(key))
      if (!entry) continue
      entry.importance = 'pending'
      entry.importanceAt = nowISO()
      queued.push(entry)
    }
    await saveIndex()
    try {
      mkdirSync(join(root, 'logs'), { recursive: true })
      appendFileSync(join(root, 'logs', 'importance.log'), queued.map((entry) => `${nowISO()} queued ${entry.id} ${entry.name} (${entry.category}/${entry.project}/${entry.session})`).join('\n') + '\n', 'utf8')
    } catch {
      // ignore log write failures
    }
    return queued
  }

  async function saveImportance(id, level, reason) {
    await loadIndex()
    const entry = entries.get(String(id))
    if (!entry) throw new Error(`未知条目：${id}`)
    const normalized = String(level).toLowerCase()
    if (!['high', 'medium', 'low'].includes(normalized)) throw new Error('level 只能是 high / medium / low')
    entry.importance = normalized
    entry.importanceReason = reason ? String(reason).slice(0, 200) : null
    entry.importanceAt = nowISO()
    await saveIndex()
    return entry
  }

  const importanceRun = { active: false, sessionId: '', batchSessions: [], total: 0, startedAt: '', finishedAt: '', error: '', startedMs: 0, targets: [] }

  function importanceMissing() {
    return [...entries.values()].filter((entry) => !entry.importance || entry.importance === 'pending')
  }

  function importanceTargets(ids) {
    if (Array.isArray(ids) && ids.length > 0) {
      const picked = []
      for (const id of ids) {
        const entry = entries.get(String(id))
        if (entry) picked.push(entry)
      }
      return picked
    }
    return importanceMissing()
  }

  function importanceRunDone() {
    if (!importanceRun.targets.length) return 0
    let done = 0
    for (const target of importanceRun.targets) {
      const entry = entries.get(target.id)
      if (entry && ['high', 'medium', 'low'].includes(entry.importance)) done += 1
    }
    return done
  }

  function importancePromptFor(targets, digests = new Map()) {
    const lines = targets.map((entry, index) => {
      const head = (index + 1) + '. id=' + entry.id + ' | ' + entry.name + ' | 类别 ' + entry.category + '/' + entry.project + ' | 会话 ' + (entry.session || '未标注') + ' | 路径 ' + entry.srcPath
      const digest = digests.get(entry.id)
      return digest ? head + '\n   会话摘要：' + digest : head
    })
    return [
      '你是「脚本中心」的重要性评估代理。请只做评估与写回，不要启动、停止或修改任何脚本。',
      '逐个读取下面脚本的源码，并结合它所属会话的上下文，判断它对这台机器的长期重要性：',
      '- high：守护、保活、定时、自动恢复，坏了会中断服务或丢数据；',
      '- medium：排障、迁移、运维类，需要时会用到；',
      '- low：一次性、实验、演示，可随时重写。',
      '对每个脚本调用工具 script_hub：{"action":"importance_save","id":"<id>","level":"high|medium|low","description":"不超过 20 字的中文理由"}。',
      '脚本清单里带了「会话摘要」；判断不清时可调用 script_hub 的 {action:"session_context", id:"<脚本 id>"} 读取该脚本所属会话的历史对话全文摘要。',
      '全部写回后，用一句话汇总结果即可。脚本清单：',
      ...lines,
    ].join('\n')
  }

  const IMPORTANCE_BATCH = 20
  const IMPORTANCE_BATCH_TIMEOUT_MS = 8 * 60 * 1000

  function importanceSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function runImportanceBatch(batch, offset) {
    const ids = batch.map((target) => target.id)
    const batchDigests = await digestForLog(batch)
    const created = await ctx.sessionController.create({ cwd: root })
    if (!importanceRun.sessionId) importanceRun.sessionId = created.sessionId
    importanceRun.batchSessions.push(created.sessionId)
    aiLog('importance-run batch ' + (offset + 1) + '-' + (offset + batch.length) + ' session ' + created.sessionId)
    await ctx.sessionController.prompt({
      requestId: randomUUID(),
      sessionId: created.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: importancePromptFor(batch, batchDigests) }],
      clientTimeZone: 'Asia/Shanghai',
    }, new AbortController().signal)
    const deadline = Date.now() + IMPORTANCE_BATCH_TIMEOUT_MS
    while (Date.now() < deadline) {
      await importanceSleep(3000)
      await loadIndex()
      const settled = ids.filter((id) => {
        const entry = entries.get(id)
        return entry && ['high', 'medium', 'low'].includes(entry.importance)
      }).length
      if (settled >= ids.length) return true
      if (importanceRun.active === false) return false
    }
    return false
  }

  async function startImportance(ids) {
    await loadIndex()
    if (importanceRun.active) throw new Error('已有重要性检测在运行，请等待完成')
    const targets = importanceTargets(ids)
    if (targets.length === 0) throw new Error('没有需要检测重要性的脚本')
    importanceRun.active = true
    importanceRun.sessionId = ''
    importanceRun.batchSessions = []
    importanceRun.total = targets.length
    importanceRun.startedAt = nowISO()
    importanceRun.finishedAt = ''
    importanceRun.error = ''
    importanceRun.startedMs = Date.now()
    importanceRun.targets = targets.map((entry) => ({ id: entry.id, name: entry.name }))
    aiLog('importance-run start targets=' + targets.length + ' batches=' + Math.ceil(targets.length / IMPORTANCE_BATCH))
    void (async () => {
      try {
        let settledBatches = 0
        for (let offset = 0; offset < targets.length; offset += IMPORTANCE_BATCH) {
          const batch = targets.slice(offset, offset + IMPORTANCE_BATCH)
          const ok = await runImportanceBatch(batch, offset)
          settledBatches += 1
          aiLog('importance-run progress ' + importanceRunDone() + '/' + targets.length + ' (batch ' + settledBatches + '/' + Math.ceil(targets.length / IMPORTANCE_BATCH) + ')')
          if (!ok) {
            importanceRun.error = '第 ' + settledBatches + ' 批（' + batch.length + ' 个）在 8 分钟内未全部写回，已停止后续批次'
            break
          }
        }
      } catch (error) {
        importanceRun.error = String(error?.message || error)
        aiLog('importance-run failed: ' + importanceRun.error)
      } finally {
        await loadIndex()
        importanceRun.active = false
        importanceRun.finishedAt = nowISO()
        aiLog('importance-run finished done=' + importanceRunDone() + ' error=' + (importanceRun.error || '-'))
        try {
          const archived = await archiveGeneratedSessions('importance', importanceRun.batchSessions, importanceRun.total, importanceRun.startedMs)
          aiLog('session-archive kind=importance sessions=' + archived.records.length + ' products=' + archived.products + ' transcripts=' + archived.transcripts + ' archived=' + archived.archived)
        } catch (error) {
          aiLog('session-archive failed: ' + (error?.message || error))
        }
      }
    })()
    return { total: targets.length, batches: Math.ceil(targets.length / IMPORTANCE_BATCH) }
  }

  const ONE_OFF_NAME = /^(check|diag|probe|test|tmp|temp|dbg|debug|one-?off|once|trial)[-_]/i
  const oneOffCache = new Map()
  const BACKUP_NAME = /(^|[-_.])(bak|backup|backups|copy|副本|备份|archive|archived)([-_.]|$)|[-_.]bak(\.[a-z]+)?$/i
  const STALE_NAME = /(^|[-_.])(old|older|legacy|deprecated|stale|obsolete|dep\b|旧版|老版|弃用|过期)([-_.]|$)/i
  const VERSION_SUFFIX = /[-_.]v(\d+)(?:\.\d+)*$/i

  function classifyEntry(name, ext, filePath, text) {
    const reasons = []
    if (ONE_OFF_NAME.test(name)) reasons.push('命名像一次检查/诊断')
    const dates = text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? []
    if (dates.length >= 2) reasons.push(`硬编码日期 ${dates[0]}（${dates.length} 处）`)
    if (/一次性|仅本次|只跑一次|one-?off|throwaway|temp(?:orary)? script/i.test(text)) reasons.push('代码内注明一次性/临时')
    const backupReasons = []
    if (BACKUP_NAME.test(name)) backupReasons.push('文件名含备份/副本标记')
    if (/备份目录|backup dir/i.test(filePath ?? '')) backupReasons.push('位于备份目录')
    const staleReasons = []
    if (STALE_NAME.test(name)) staleReasons.push('文件名含 旧版/legacy/old')
    if (VERSION_SUFFIX.test(basename(name, ext))) staleReasons.push(`带版本号 ${VERSION_SUFFIX.exec(basename(name, ext))[1]}`)
    if (/已废弃|已弃用|deprecated|legacy version|旧版本/i.test(text)) staleReasons.push('代码内注明旧版/弃用')
    return {
      oneOff: reasons.length > 0,
      oneOffReason: reasons.slice(0, 2).join('；'),
      backup: backupReasons.length > 0,
      backupReason: backupReasons.slice(0, 2).join('；'),
      stale: staleReasons.length > 0,
      staleReason: staleReasons.slice(0, 2).join('；'),
    }
  }

  async function detectOneOff(entry) {
    const cacheKey = `${entry.id}:${entry.sha1 ?? ''}:${entry.size ?? 0}`
    const cached = oneOffCache.get(entry.id)
    if (cached && cached.key === cacheKey) return cached.value
    let text = ''
    try {
      const handle = await openFile(entry.filePath, 'r')
      const buffer = Buffer.alloc(16384)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      await handle.close()
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } catch {
      text = ''
    }
    const value = classifyEntry(entry.name, entry.ext, entry.filePath, text)
    oneOffCache.set(entry.id, { key: cacheKey, value })
    return value
  }

  const BLURB_KEY = /^\s*(?:#|\/\/|--|;|REM\b|\*)\s*(?:作用|用途|功能|说明|summary|purpose)\s*[:：]\s*(.+)$/i
  const COMMENT_LINE = /^\s*(?:#|\/\/|;|REM\b)\s*(\S.{2,110})$/
  const BLURB_NOISE = /requires|encoding|coding[:=]|copyright|©|^\s*[=\-*#]{3,}\s*$|precompiled|chcp|@echo|vim?:|\*\s*-\*/i
  const blurbCache = new Map()

  function cleanBlurb(value) {
    return String(value).replace(/\s+/g, ' ').trim().replace(/^[-—:：\s]+/, '').slice(0, 80)
  }

  function extractBlurbText(text, description) {
    const lines = String(text ?? '').split(/\r?\n/).slice(0, 60)
    let found = ''
    let source = ''
    for (const line of lines) {
      const matched = BLURB_KEY.exec(line)
      if (matched) {
        found = cleanBlurb(matched[1])
        source = '脚本头部注释'
        break
      }
    }
    if (found === '') {
      let started = false
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') {
          if (started) break
          continue
        }
        if (!/^(?:#|\/\/|;|REM\b)/i.test(trimmed)) break
        started = true
        if (/^(?:#!|#requires)/i.test(trimmed)) continue
        const matched = COMMENT_LINE.exec(line)
        if (matched && !BLURB_NOISE.test(matched[1]) && matched[1].trim().length <= 90) {
          found = cleanBlurb(matched[1])
          source = '文件头注释'
          break
        }
      }
    }
    if (found === '' && description) {
      found = cleanBlurb(description)
      source = '归档说明'
    }
    return { blurb: found, blurbSource: found === '' ? '' : source }
  }

  function baseNameOf(name) {
    return String(name ?? '')
      .replace(/\.[^.]+$/, '')
      .replace(VERSION_SUFFIX, '')
      .replace(/[-_.](bak|backup|copy|old|legacy|副本|备份)$/i, '')
      .replace(/\(\d+\)$/, '')
      .trim()
      .toLowerCase()
  }

  function trimPurpose(value) {
    let out = String(value ?? '').trim()
    out = out.replace(/[（(][^（()）]*$/, '').trim()
    out = out.replace(/[\s+＋&与和及,、/\\-]+$/, '').trim()
    out = out.replace(/[A-Za-z0-9._-]+$/, '').trim()
    return out.replace(/[\s+＋&与和及,、/\\-]+$/, '').trim()
  }

  function shortPurpose(text) {
    const cleaned = cleanBlurb(String(text ?? '')).replace(/[\u0060*_#>]/g, ' ').replace(/\s+/g, ' ').trim()
    if (cleaned === '') return ''
    const quoted = cleaned.replace(/^[“”"'「」『』\s]+/, '').replace(/[“”"'「」『』\s]+$/, '')
    let value = quoted.split(/[：:，,。;；、]/)[0].trim()
    if (value.length < 4) value = quoted
    if (value.length > 16) {
      const clipped = trimPurpose(value.slice(0, 16))
      value = clipped.length >= 6 ? clipped : value.slice(0, 16)
    }
    const trimmed = trimPurpose(value)
    if (trimmed.length >= 4) return trimmed
    return value.slice(0, 16).trim()
  }

  const originCache = new Map()

  async function originTimeOf(entry) {
    const sessionId = String(entry.sessionId ?? '').trim()
    if (sessionId !== '' && originCache.has(sessionId)) return originCache.get(sessionId)
    let value = Number(new Date(entry.createdAt ?? 0)) || 0
    if (sessionId !== '') {
      const file = await findSessionFile(sessionId)
      if (file) {
        try {
          const stats = statSync(file)
          value = stats.birthtimeMs || stats.mtimeMs || value
        } catch {
          // keep createdAt
        }
      }
      originCache.set(sessionId, value)
    }
    return value
  }

  async function writeTitleIntoDoc(entry) {
    try {
      let text = await readFile(entry.docPath, 'utf8')
      text = /^#\s+.*$/m.test(text) ? text.replace(/^#\s+.*$/m, '# ' + entry.title) : '# ' + entry.title + '\n\n' + text
      await writeFile(entry.docPath, text, 'utf8')
    } catch {
      // doc missing
    }
  }

  async function applyAutoTitles() {
    await loadIndex()
    const groups = new Map()
    for (const entry of entries.values()) {
      if (entry.titleSource === 'manual') continue
      const key = entry.category + '/' + entry.project + '/' + baseNameOf(entry.name) + '.' + entry.ext
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(entry)
    }
    let changed = 0
    for (const list of groups.values()) {
      const ranked = []
      for (const entry of list) ranked.push({ entry, origin: await originTimeOf(entry) })
      ranked.sort((a, b) => (a.origin - b.origin) || String(a.entry.createdAt ?? '').localeCompare(String(b.entry.createdAt ?? '')))
      const total = ranked.length
      for (let index = 0; index < total; index += 1) {
        const entry = ranked[index].entry
        const raw = shortPurpose((await scriptBlurb(entry)).blurb)
        const cjk = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length
        const incomplete = /[A-Za-z0-9]$/.test(raw) || cjk < 2
        const purpose = (raw.length >= 6 && !incomplete) ? raw : baseNameOf(entry.name)
        const version = total > 1 ? ' v' + (index + 1) : ''
        let title = (purpose + version).slice(0, 40).trim()
        if (title === '') continue
        if (entry.title !== title) {
          entry.title = title
          entry.titleSource = 'auto'
          await writeTitleIntoDoc(entry)
          changed += 1
        } else {
          entry.titleSource = 'auto'
        }
      }
    }
    const byTitle = new Map()
    for (const entry of entries.values()) {
      if (entry.titleSource === 'manual') continue
      const key = entry.category + '/' + entry.project + '/' + String(entry.title ?? '')
      if (!byTitle.has(key)) byTitle.set(key, [])
      byTitle.get(key).push(entry)
    }
    for (const list of byTitle.values()) {
      if (list.length < 2) continue
      const exts = new Set(list.map(entry => String(entry.ext ?? '').toLowerCase()))
      if (exts.size < 2) continue
      for (const entry of list) {
        const tag = '(' + String(entry.ext ?? '').toLowerCase().replace(/^\./, '') + ')'
        entry.title = (String(entry.title ?? '') + ' ' + tag).slice(0, 40).trim()
        await writeTitleIntoDoc(entry)
        changed += 1
      }
    }
    if (changed > 0) await saveIndex()
    return changed
  }

  async function sessionTitleOfId(sessionId) {
    const file = await findSessionFile(String(sessionId ?? ''))
    if (!file) return ''
    return (await readSessionTitle(file)) ?? ''
  }

  // 把插件自己开的那次会话的存档（多帧 zstd）复制进 logs/sessions/，会话本体也留下来
  async function archiveSessionTranscript(sessionId, title = '') {
    const id = String(sessionId ?? '').trim()
    if (!id) return ''
    const source = await findSessionFile(id)
    if (!source) return ''
    const stamp = id.replace(/^session-/, '')
    const safeTitle = safeSegment(title || stamp) || stamp
    const target = join(logDir, 'sessions', `${stamp}-${safeTitle}.jsonl.zst`)
    try {
      statSync(target)
      return target
    } catch {
      // not archived yet
    }
    try {
      mkdirSync(join(logDir, 'sessions'), { recursive: true })
      await copyFile(source, target)
      return target
    } catch (error) {
      aiLog('session-transcript failed ' + id + ': ' + (error?.message || error))
      return ''
    }
  }

  // 等价于用户在 DSH 侧边栏点「归档会话」：走官方公共动词 workspaceRegistry.archiveSession。
  // 刚跑完的会话可能还挂着 turn，官方动词会拒绝（active (turn)），这里短暂重试等它落定。
  async function archiveSessionOfficial(sessionId, attempts = 6, delayMs = 1500) {
    const id = String(sessionId ?? '').trim()
    if (!id) throw new Error('缺少会话 id')
    const registry = ctx.workspaceRegistry
    if (typeof registry?.archiveSession !== 'function') {
      throw new Error('当前 DSH 版本没有 workspaceRegistry.archiveSession')
    }
    let last = null
    for (let i = 0; i < attempts; i += 1) {
      try {
        await registry.archiveSession(id)
        return
      } catch (error) {
        last = error
        const text = String(error?.message || error)
        if (!/active \(turn\)|active/.test(text)) throw error
        if (i === attempts - 1) break
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    throw last ?? new Error('归档失败')
  }

  // 会话还没落定时，后台继续补归档并回写记录（面板刷新即可看到「已归档」）
  function scheduleArchiveRetry(sessionId, delays = [20000, 45000, 90000]) {
    const run = (index) => {
      if (index >= delays.length) return
      const timer = setTimeout(async () => {
        try {
          await archiveSessionOfficial(sessionId, 1)
          await patchGeneratedSession(sessionId, { archived: true, archiveError: '' })
          aiLog('session-archive retry ok ' + sessionId)
        } catch (error) {
          const text = String(error?.message || error)
          await patchGeneratedSession(sessionId, { archived: false, archiveError: text })
          aiLog('session-archive retry failed ' + sessionId + ': ' + text)
          run(index + 1)
        }
      }, delays[index])
      timer?.unref?.()
    }
    run(0)
  }

  async function patchGeneratedSession(sessionId, patch) {
    let touched = false
    for (const item of generatedSessions) {
      if (item.sessionId !== sessionId) continue
      Object.assign(item, patch)
      touched = true
    }
    if (touched) await saveIndex()
  }

  async function archiveProductsOfSession(sessionId, sinceMs, title) {
    const since = Number(sinceMs || Date.now()) - 5000
    const known = new Set(Array.from(entries.values()).map((entry) => entry.filePath))
    const products = []
    const dirs = Array.from(new Set([root, ...watchDirs, process.cwd()].filter((dir) => typeof dir === 'string' && dir !== '')))
    for (const dir of dirs) {
      let files = []
      try {
        files = await listScriptsIn(dir)
      } catch {
        continue
      }
      for (const file of files) {
        if (file.mtime < since) continue
        if (known.has(file.path)) continue
        try {
          const entry = await archiveFile(file.path, { sessionId, session: title })
          known.add(entry.filePath)
          products.push({ id: entry.id, name: entry.name, path: entry.filePath, sessionId })
        } catch (error) {
          aiLog('session-product skipped ' + file.path + ': ' + (error?.message || error))
        }
      }
    }
    return products
  }

  async function archiveSessionProducts(sessionIds, sinceMs, fallbackTitle = '') {
    const products = []
    for (const sessionId of sessionIds ?? []) {
      const title = (await sessionTitleOfId(sessionId)) || (sessionId === '' ? fallbackTitle : '')
      try {
        products.push(...(await archiveProductsOfSession(sessionId, sinceMs, title)))
      } catch (error) {
        aiLog('session-product scan failed ' + sessionId + ': ' + (error?.message || error))
      }
    }
    if (products.length > 0) await applyAutoTitles()
    return products
  }

  // 会话归档：每个会话一条记录（标题 / 产物 / 存档路径），扫产物失败也要留痕
  async function archiveGeneratedSessions(kind, sessionIds, total, sinceMs) {
    const ids = (sessionIds ?? []).filter((id) => typeof id === 'string' && id !== '')
    const records = []
    let productTotal = 0
    let transcriptTotal = 0
    let archivedTotal = 0
    for (const sessionId of ids) {
      let title = ''
      let products = []
      let transcript = ''
      let errorText = ''
      let archived = false
      let archiveError = ''
      try {
        title = (await sessionTitleOfId(sessionId)) ?? ''
      } catch (error) {
        errorText = String(error?.message || error)
      }
      const archiveTitle = title || `插件会话 ${sessionId.slice(-8)}`
      // 先按官方方式归档，让它在侧边栏里跟手动归档完全一样消失
      try {
        await archiveSessionOfficial(sessionId)
        archived = true
      } catch (error) {
        archiveError = String(error?.message || error)
        aiLog('session-archive official failed ' + sessionId + ': ' + archiveError)
        scheduleArchiveRetry(sessionId)
      }
      try {
        products = await archiveProductsOfSession(sessionId, sinceMs, archiveTitle)
      } catch (error) {
        errorText = errorText || String(error?.message || error)
        aiLog('session-product scan failed ' + sessionId + ': ' + (error?.message || error))
      }
      try {
        transcript = await archiveSessionTranscript(sessionId, archiveTitle)
      } catch (error) {
        aiLog('session-transcript failed ' + sessionId + ': ' + (error?.message || error))
      }
      if (products.length > 0) await applyAutoTitles()
      productTotal += products.length
      if (transcript) transcriptTotal += 1
      if (archived) archivedTotal += 1
      recordGeneratedSession({
        kind,
        sessionId,
        title: archiveTitle,
        sessions: [sessionId],
        total,
        products,
        transcript,
        archived,
        archiveError,
        error: errorText,
      })
      records.push({ sessionId, title: archiveTitle, products, transcript, archived, archiveError })
    }
    if (records.length > 0) await saveIndex()
    return { records, products: productTotal, transcripts: transcriptTotal, archived: archivedTotal }
  }

  function recordGeneratedSession(record) {
    generatedSessions.push({ ...record, at: nowISO() })
    while (generatedSessions.length > 60) generatedSessions.shift()
  }

  async function scriptBlurb(entry) {
    let docStamp = 0
    try {
      docStamp = statSync(entry.docPath).mtimeMs
    } catch {
      docStamp = 0
    }
    const cacheKey = `${entry.sha1 ?? ''}:${entry.size ?? 0}:${docStamp}`
    const cached = blurbCache.get(entry.id)
    if (cached && cached.key === cacheKey) return cached.value
    let text = ''
    try {
      const handle = await openFile(entry.filePath, 'r')
      const buffer = Buffer.alloc(8192)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      await handle.close()
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } catch {
      text = ''
    }
    const lines = text.split(/\r?\n/).slice(0, 60)
    let found = ''
    let source = ''
    for (const line of lines) {
      const matched = BLURB_KEY.exec(line)
      if (matched) {
        found = cleanBlurb(matched[1])
        source = '脚本头部注释'
        break
      }
    }
    if (found === '') {
      let started = false
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') {
          if (started) break
          continue
        }
        if (!/^(?:#|\/\/|;|REM\b)/i.test(trimmed)) break
        started = true
        if (/^(?:#!|#requires)/i.test(trimmed)) continue
        const matched = COMMENT_LINE.exec(line)
        if (matched && !BLURB_NOISE.test(matched[1]) && matched[1].trim().length <= 90) {
          found = cleanBlurb(matched[1])
          source = '文件头注释'
          break
        }
      }
    }
    if (found === '') {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const doc = /^\s*(?:"""|''')(.*)$/.exec(line)
        if (doc) {
          const inline = cleanBlurb(doc[1].replace(/"""|'''/g, ''))
          if (inline !== '') {
            found = inline
          } else {
            const next = lines.slice(index + 1).find((item) => item.trim() !== '' && !/^\s*(?:"""|''')/.test(item))
            if (next) found = cleanBlurb(next)
          }
          source = '脚本 docstring'
          break
        }
      }
    }
    if (found === '' && entry.description) {
      found = cleanBlurb(entry.description)
      source = '归档说明'
    }
    {
      try {
        const docText = await readFile(entry.docPath, 'utf8')
        const docLines = docText.split(/\r?\n/)
        const sectionIndex = docLines.findIndex((line) => /^#{2,3}\s*(?:作用|功能)/.test(line.trim()))
        if (sectionIndex >= 0) {
          const picked = []
          for (const line of docLines.slice(sectionIndex + 1, sectionIndex + 8)) {
            const trimmed = line.trim()
            if (trimmed === '') {
              if (picked.length > 0) break
              continue
            }
            if (trimmed.startsWith('#')) break
            if (trimmed.startsWith('|') || trimmed.startsWith('>')) continue
            picked.push(trimmed)
            if (picked.join('').length >= 60) break
          }
          const fromDoc = cleanBlurb(picked.join(' '))
          const weak = found === '' || source === '脚本 docstring' || source === '文件头注释' && !/[\u4e00-\u9fa5]/.test(found)
          if (fromDoc !== '' && weak) {
            found = fromDoc.length > 90 ? fromDoc.slice(0, 90) : fromDoc
            source = '文档「作用」一节'
          }
        }
      } catch {
        // 没文档就保持空
      }
    }
    const value = { blurb: found, blurbSource: found === '' ? '' : source }
    blurbCache.set(entry.id, { key: cacheKey, value })
    return value
  }

  const routes = [
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/ai-probe',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        const text = String(body?.text ?? '')
        const sessionId = randomUUID()
        const handle = await ctx.agents.create({
          sessionId,
          meta: { cwd: root, origin: 'subagent', delegationDepth: 1, agentPreset: config.agentPreset ?? 'standard' },
          agentOptions: {
            provider: config.modelProvider ?? 'deepseek-account',
            model: config.modelName ?? 'deepseek-flash',
            reasoningEffort: config.reasoningEffort ?? 'max',
          },
        })
        const seen = []
        const off = ctx.on('assistant/message', (...args) => { seen.push(args) })
        await handle.agent.followup({ content: [{ type: 'text', text }], source: { kind: 'script-hub-probe' } })
        const deadline = Date.now() + 120000
        let running = false
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 400))
          if (handle.agent.status === 'running') running = true
          else if (running) break
        }
        off()
        const session = handle.agent.session
        const eventish = session && (session.events || session.log?.events || session.log)
        let sample = ''
        try {
          const list = Array.isArray(eventish) ? eventish : []
          const tail = list.slice(-8).map((event) => ({ type: event.type, data: JSON.stringify(event.data ?? {}).slice(0, 400) }))
          sample = JSON.stringify(tail).slice(0, 3000)
        } catch { sample = 'unserializable' }
        await handle.dispose()
        return writeJson(res, 200, { ok: true, sessionId, running, tools: Object.keys(handle.agent.ctx?.tools ?? {}), eventsSample: sample, seen: seen.length })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/ai-start',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          const started = await startAiDocs(body?.ids)
          return writeJson(res, 200, { ok: true, ...started })
        } catch (error) {
          return writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/ai-status',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
        return writeJson(res, 200, {
          ok: true,
          active: aiRun.active,
          sessionId: aiRun.sessionId,
          total: aiRun.total,
          done: aiRunDone(),
          batches: aiRun.batchSessions?.length ?? 0,
          startedAt: aiRun.startedAt,
          finishedAt: aiRun.finishedAt,
          error: aiRun.error,
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/importance-run',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          const started = await startImportance(body?.ids)
          return writeJson(res, 200, { ok: true, ...started })
        } catch (error) {
          return writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/importance-status',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
        await loadIndex()
        return writeJson(res, 200, {
          ok: true,
          active: importanceRun.active,
          sessionId: importanceRun.sessionId,
          total: importanceRun.total,
          done: importanceRunDone(),
          missing: importanceMissing().length,
          startedAt: importanceRun.startedAt,
          finishedAt: importanceRun.finishedAt,
          error: importanceRun.error,
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/autoname',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        const changed = await applyAutoTitles()
        return writeJson(res, 200, { ok: true, changed })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/archive-products',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        const sessionId = String(body.sessionId ?? '').trim()
        const sinceMs = Number(body.sinceMs) || Date.now()
        try {
          const products = await archiveSessionProducts([sessionId], sinceMs, String(body.session ?? '').trim())
          return writeJson(res, 200, { ok: true, products })
        } catch (error) {
          return writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/status',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
        await loadIndex()
        const reconciled = await reconcileRuns()
        const snapshot = statusSnapshot()
        const running = []
        const exited = []
        const scheduled = new Map()
        for (const entry of entries.values()) {
          const status = snapshot.get(entry.id) ?? withStatus(entry)
          if (status.task) {
            const key = status.task
            const hit = scheduled.get(key) ?? { task: key, status: status.taskStatus, running: status.taskRunning, scripts: [] }
            hit.status = status.taskStatus || hit.status
            hit.running = hit.running || status.taskRunning
            hit.scripts.push(entry.name)
            scheduled.set(key, hit)
          }
          if (status.running) {
            running.push({ id: entry.id, name: entry.name, title: entry.title ?? '', pid: status.pid, state: status.runState, procName: status.procName ?? '', task: status.task ?? '', uptimeMs: status.uptimeMs, startedAt: status.runState === 'proc' ? entry.lastRun?.startedAt ?? '' : entry.lastRun?.startedAt ?? '', logPath: entry.lastRun?.logPath ?? '' })
          } else if (status.runState !== 'idle' && status.runState !== 'task-idle') {
            exited.push({ id: entry.id, name: entry.name, exitCode: status.exitCode, exitedAt: status.exitedAt, exitReason: status.exitReason })
          }
        }
        const probes = probePorts()
        return writeJson(res, 200, { ok: true, checkedAt: lastRunCheckAt || nowISO(), reconciled, running, exited: exited.slice(0, 20), scheduled: [...scheduled.values()], probes, probesOk: probes.every((item) => item.listening), runningCount: running.length, procCount: running.filter((item) => item.state === 'proc').length, scheduledRunning: [...scheduled.values()].filter((item) => item.running).length })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/list',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
        const tStart = Date.now()
        await loadIndex()
        const tLoaded = Date.now()
        const stamp = Date.parse(lastRunCheckAt || '') || 0
        if (Date.now() - stamp > 20000) await reconcileRuns()
        const tReconciled = Date.now()
        const tTitles = Date.now()
        const titles = await sessionTitleMap()
        const titlesMs = Date.now() - tTitles
        const snapshot = statusSnapshot()
        const cost = { docTitle: 0, quality: 0, oneOff: 0, blurb: 0 }
        const timeIt = async (key, task) => {
          const at = Date.now()
          try {
            return await task()
          } finally {
            cost[key] += Date.now() - at
          }
        }
        const list = await Promise.all([...entries.values()].map(async (entry) => {
          const status = snapshot.get(entry.id) ?? withStatus(entry)
          const [docTitle, quality, oneOff, blurb, fileCreatedAt] = await Promise.all([
            entry.title ? Promise.resolve(entry.title) : timeIt('docTitle', () => readDocTitle(entry.docPath)),
            timeIt('quality', () => docQualityOf(entry)),
            timeIt('oneOff', () => detectOneOff(entry)),
            timeIt('blurb', () => scriptBlurb(entry)),
            fileCreatedAtOf(entry),
          ])
          return {
            ...status,
            hidden: entry.hidden === true,
            title: docTitle || basename(entry.name, entry.ext),
            realName: entry.name,
            sessionTitle: firstSegment(sessionTitleFor({ sessionId: (/^会话 ([0-9a-f]{8})$/i.exec(String(entry.session ?? '')) ?? [])[1] ?? entry.sessionId, sessionTitle: entry.sessionTitle }, titles)),
            ...quality,
            needDoc: quality.docState !== 'ok',
            importance: entry.importance ?? null,
            importanceReason: entry.importanceReason ?? null,
            createdAt: entry.createdAt ?? null,
            fileCreatedAt,
            newAt: entry.newAt ?? null,
            seenAt: entry.seenAt ?? null,
            ...oneOff,
            ...blurb,
          }
        }))
        const tBuilt = Date.now()
        const baseOf = (item) => String(item.name || '')
          .toLowerCase()
          .replace(/\.[a-z0-9]+$/, '')
          .replace(VERSION_SUFFIX, '')
          .replace(/[-_.](bak|backup|copy|old|legacy|副本|备份)$/, '')
        const groups = new Map()
        for (const item of list) {
          const key = `${item.category}/${item.project}/${baseOf(item)}`
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(item)
        }
        for (const items of groups.values()) {
          const pool = items.filter((item) => !BACKUP_NAME.test(item.name))
          if (pool.length < 2) continue
          const newest = pool.reduce((a, b) => ((b.mtime ?? '') > (a.mtime ?? '') ? b : a))
          for (const item of pool) {
            if (item === newest) continue
            item.stale = true
            item.staleReason = item.staleReason ? `${item.staleReason}；同名脚本的较旧版本` : '同名脚本的较旧版本'
          }
        }
        list.sort((a, b) => (a.category + a.title).localeCompare(b.category + b.title))
        const counts = {}
        const sessionCounts = {}
        for (const item of list) {
          counts[item.category] = (counts[item.category] ?? 0) + 1
          const key = item.sessionTitle || item.session || '未标注'
          sessionCounts[key] = (sessionCounts[key] ?? 0) + 1
        }
        for (const item of list) {
          delete item.sha1
          delete item.docHint
          delete item.docCustomized
          delete item.importanceAt
          delete item.titleSource
          if (item.lastRun && typeof item.lastRun === 'object' && typeof item.lastRun.command === 'string' && item.lastRun.command.length > 160) {
            item.lastRun = { ...item.lastRun, command: `${item.lastRun.command.slice(0, 157)}…` }
          }
        }
        const payload = { root, watchDirs, counts, sessionCounts, entries: list, running: list.filter((item) => item.running).length, pending: pendingDocs().length, docNeed: list.filter((item) => item.docState !== 'ok').length, generatedSessions: generatedSessions.slice(-20).reverse() }
        if (/[?&]prof=1/.test(String(req.url ?? ''))) {
          payload.profile = { load: tLoaded - tStart, reconcile: tReconciled - tLoaded, titles: titlesMs, build: tBuilt - tReconciled, total: Date.now() - tStart, entries: list.length, cost }
          log('info', `list profile ${JSON.stringify(payload.profile)}`)
        }
        writeJson(res, 200, payload)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/register',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          if (typeof body.path !== 'string' || body.path.trim() === '') throw new Error('path is required')
          const entry = await archiveFile(resolve(body.path), {
            category: body.category,
            project: body.project,
            session: body.session,
            description: body.description,
            title: typeof body.title === 'string' ? body.title : undefined,
          })
          writeJson(res, 200, { ok: true, entry: withStatus(entry) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/start',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          writeJson(res, 200, { ok: true, entry: await startEntry(String(body.id ?? '')) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/stop',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          writeJson(res, 200, { ok: true, entry: await stopEntry(String(body.id ?? '')) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/logs',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
        await loadIndex()
        const url = new URL(req.url ?? '/', 'http://local')
        const entry = entries.get(url.searchParams.get('id') ?? '')
        if (!entry) return writeJson(res, 404, { ok: false, error: 'unknown entry' })
        const lines = Math.min(2000, Math.max(20, Number(url.searchParams.get('lines') ?? 300) || 300))
        writeJson(res, 200, { ok: true, id: entry.id, logPath: entry.lastRun?.logPath ?? null, text: await tailLog(entry, lines), running: runStateOf(entry).running })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/doc',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        await loadIndex()
        const url = new URL(req.url ?? '/', 'http://local')
        const entry = entries.get(url.searchParams.get('id') ?? '')
        if (!entry) return writeJson(res, 404, { ok: false, error: 'unknown entry' })
        if (req.method === 'GET') {
          return writeJson(res, 200, { ok: true, id: entry.id, docPath: entry.docPath, title: entry.title ?? (await readDocTitle(entry.docPath)), text: await readDoc(entry) })
        }
        if (req.method === 'POST') {
          try {
            const body = await readBody(req)
            if (typeof body.text !== 'string') throw new Error('text is required')
            await writeFile(entry.docPath, body.text, 'utf8')
            entry.docCustomized = true
            entry.title = (await readDocTitle(entry.docPath)) ?? entry.title ?? null
            entry.updatedAt = nowISO()
            await saveIndex()
            writeJson(res, 200, { ok: true, docPath: entry.docPath })
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        writeJson(res, 405, { error: 'GET or POST only' })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/hide',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          const entry = await setHidden(String(body.id ?? ''), Boolean(body.hidden))
          writeJson(res, 200, { ok: true, id: entry.id, hidden: entry.hidden === true })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/seen',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          const entry = await markSeen(String(body.id ?? ''))
          writeJson(res, 200, { ok: true, id: entry.id, seenAt: entry.seenAt ?? null })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/rename',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          const entry = await renameEntry(String(body.id ?? ''), body.title)
          writeJson(res, 200, { ok: true, entry: { ...withStatus(entry), title: entry.title, realName: entry.name } })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/delete',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req)
          const id = String(body.id ?? '')
          if (id === '') throw new Error('id is required')
          const removed = await deleteEntry(id)
          writeJson(res, 200, { ok: true, removed })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/health',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        await loadIndex()
        writeJson(res, 200, {
          ok: true,
          root,
          watchDirs,
          autoArchive,
          entries: entries.size,
          running: [...entries.values()].filter((entry) => runStateOf(entry).running).length,
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/import-scan',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        try {
          const data = await scanImportSources()
          writeJson(res, 200, { ok: true, ...data, pending: pendingDocs().length })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/import-run',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        try {
          const body = await readBody(req, 1024 * 256)
          const keys = Array.isArray(body.keys) ? body.keys.map((key) => String(key)) : []
          if (keys.length === 0) throw new Error('keys is required')
          if (keys.length > 50) throw new Error('too many keys (max 50)')
          const ai = body.ai === true
          const results = await importEntries(keys, { ai })
          writeJson(res, 200, { ok: true, results, pending: pendingDocs().length })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/import-status',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        writeJson(res, 200, { ok: true, pending: pendingDocs(), log: aiLogPath })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/importance-queue',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : Array.isArray(body.keys) ? body.keys.map((key) => String(key)) : []
        if (ids.length === 0) return writeJson(res, 400, { ok: false, error: 'ids 不能为空' })
        const queued = await queueImportance(ids)
        writeJson(res, 200, { ok: true, queued: queued.length, pending: importanceEntries().filter((entry) => entry.importance === 'pending').length })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-script-hub/importance-pending',
      handler: async (req, res) => {
        if (!isLoopback(req) || !isSameSite(req)) return writeJson(res, 403, { error: 'loopback same-site only' })
        if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
        await loadIndex()
        const items = [...entries.values()]
          .filter((entry) => entry.importance === 'pending')
          .map((entry) => ({ id: entry.id, name: entry.name, title: entry.title ?? null, category: entry.category, project: entry.project, session: entry.session, filePath: entry.filePath, docPath: entry.docPath }))
        writeJson(res, 200, { ok: true, items })
      },
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    // 预热耗时的系统查询，避免用户第一次打开面板时卡住
    const warm = setTimeout(() => {
      try {
        refreshTaskStates()
        procListRows()
        probePorts()
        taskIndex()
        // 预热文档/说明缓存，让第一次打开面板不再等待
        void (async () => {
          try {
            await loadIndex()
            const started = Date.now()
            await Promise.all([...entries.values()].map(async (entry) => {
              await Promise.all([readDocTitle(entry.docPath), docQualityOf(entry), detectOneOff(entry), scriptBlurb(entry)])
            }))
            log('info', `warmed entry caches in ${Date.now() - started}ms (${entries.size} entries)`)
            await backfillFileTimes()
            // 上次没归档成功的插件会话，这里补一次（最多 10 条，失败就留着原因待下次）
            const pendingArchive = generatedSessions.filter((item) => item.sessionId && item.archived !== true).slice(-10)
            for (const item of pendingArchive) {
              try {
                await archiveSessionOfficial(item.sessionId, 2, 1500)
                await patchGeneratedSession(item.sessionId, { archived: true, archiveError: '' })
                log('info', `backfill archived ${item.sessionId}`)
              } catch (error) {
                await patchGeneratedSession(item.sessionId, { archived: false, archiveError: String(error?.message || error) })
              }
            }
          } catch (error) {
            log('warn', `warmup entries failed: ${error?.message || error}`)
          }
        })()
      } catch (error) {
        log('warn', `warmup failed: ${error?.message || error}`)
      }
    }, 1200)
    if (typeof warm.unref === 'function') warm.unref()
    return () => {
      clearTimeout(warm)
      for (const dispose of disposers) dispose()
    }
  }, 'script-hub: routes')

  // ---- tool ---------------------------------------------------------------
  ctx.tools.register({
    name: 'script_hub',
    description:
      '脚本中心：把脚本归档到 D:\\DSH代码插件（按类别/项目/会话分目录）并生成同名 .md 文档；可列出、注册、启动、停止、删除脚本，读取日志与文档；action=pending 列出待 AI 补写文档的脚本，用 doc_save 写回后自动标记完成；action=importance_pending 列出待判定重要性的脚本（面板「检测重要性」排队），用 importance_save 传 id/level/description 写回；action=session_context 读取某个脚本或某个会话标题对应的历史对话摘要（用于判定重要性/补文档）。历史脚本一键导入在面板「导入历史脚本」里。归档时请把当前会话标题通过 session 传入，便于按会话归类。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list | register | start | stop | rename | delete | logs | doc | doc_save | pending | importance_pending | importance_save | session_context' },
        title: { type: 'string', description: 'rename 时的新显示名称（写进文档一级标题）' },
        path: { type: 'string', description: 'register 时的脚本绝对路径' },
        id: { type: 'string', description: 'start/stop/logs/doc/doc_save 时的条目 id' },
        category: { type: 'string', description: 'register 时覆盖自动分类（如 机器人 / DSH 工具 / 通用）' },
        project: { type: 'string', description: 'register 时覆盖项目目录名' },
        session: { type: 'string', description: 'register 时写入归属会话（建议传当前会话标题）' },
        description: { type: 'string', description: 'register 时写入文档「作用」一节的一句话说明；importance_save 时为判定理由' },
        title: { type: 'string', description: 'register 时的显示名（写成文档一级标题，面板显示）' },
        level: { type: 'string', description: 'importance_save 时的等级：high | medium | low' },
        doc: { type: 'string', description: 'doc_save 时的完整 Markdown 文本' },
        lines: { type: 'number', description: 'logs 时读取的行数，默认 200' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const action = String(args?.action ?? '')
      await loadIndex()
      if (action === 'list') {
        const rows = [...entries.values()].map(withStatus)
        if (rows.length === 0) return `脚本中心为空（归档根目录 ${root}）。`
        return rows
          .map((entry) => {
            const shown = entry.title || basename(entry.name, entry.ext)
            const real = shown === entry.name ? '' : ` (${entry.name})`
            return `${entry.running ? '●' : '○'} [${entry.category}/${entry.project}/${entry.session || '未标注'}] ${shown}${real} (id=${entry.id})${entry.description ? ' — ' + entry.description : ''}`
          })
          .join('\n')
      }
      if (action === 'pending') {
        const list = pendingDocs()
        if (list.length === 0) return '没有待生成的文档。'
        return list
          .map((item) => `- ${item.name}（${item.category}/${item.project}/${item.session}）\n  脚本 ${item.filePath}\n  文档 ${item.docPath}`)
          .join('\n')
      }
      if (action === 'importance_pending') {
        const items = [...entries.values()].filter((entry) => entry.importance === 'pending')
        if (items.length === 0) return '没有待检测重要性的脚本。'
        return items
          .map((entry) => `- id=${entry.id} ${entry.title || entry.name}（${entry.category}/${entry.project}/${entry.session || '未标注'}）\n  脚本 ${entry.filePath}\n  文档 ${entry.docPath}`)
          .join('\n')
      }
      if (action === 'importance_save') {
        if (!args?.id) throw new Error('importance_save 需要 id')
        const level = String(args?.level ?? '')
        const saved = await saveImportance(args.id, level, args?.description)
        return `已记录重要性：${saved.title || saved.name} → ${IMPORTANCE_LABEL[saved.importance] || saved.importance}`
      }
      if (action === 'session_context') {
        const key = String(args?.id ?? args?.session ?? '')
        if (key === '') throw new Error('session_context 需要 id 或 session')
        const digest = await sessionDigestForKeys(key)
        return digest === '' ? '（没有找到该脚本/会话的历史对话摘要）' : digest
      }
      if (action === 'register') {
        if (!args?.path) throw new Error('register 需要 path')
        const entry = await archiveFile(resolve(String(args.path)), {
          category: args.category ? String(args.category) : undefined,
          project: args.project ? String(args.project) : undefined,
          session: args.session ? String(args.session) : undefined,
          description: args.description ? String(args.description) : undefined,
          title: args.title ? String(args.title) : undefined,
        })
        if (args.title) {
          entry.titleSource = 'manual'
          await saveIndex()
        } else {
          await applyAutoTitles()
        }
        return `已归档：${entry.filePath}\n文档：${entry.docPath}\n类别：${entry.category} / 项目：${entry.project} / 会话：${entry.session}\n显示名：${entry.title || entry.name}`
      }
      const id = String(args?.id ?? '')
      const entry = entries.get(id)
      if (!entry) throw new Error(`未知条目：${id}（先用 action=list 查看）`)
      if (action === 'start') {
        const updated = await startEntry(id)
        return `已启动 ${entry.name}，pid=${updated.pid ?? '-'}，日志：${entry.lastRun?.logPath ?? '-'}`
      }
      if (action === 'stop') {
        const updated = await stopEntry(id)
        return `已停止 ${entry.name}${updated.running ? '（仍在运行，请查看日志）' : ''}`
      }
      if (action === 'logs') {
        const lines = Math.min(2000, Math.max(20, Number(args?.lines ?? 200) || 200))
        const text = await tailLog(entry, lines)
        return text === '' ? '（暂无日志，脚本可能还没启动过）' : text
      }
      if (action === 'doc') {
        const text = await readDoc(entry)
        return text === '' ? `（文档不存在：${entry.docPath}）` : text
      }
      if (action === 'delete') {
        const removed = await deleteEntry(id)
        return `已删除条目 ${removed.name}`
      }
      if (action === 'rename') {
        if (typeof args?.title !== 'string') throw new Error('rename 需要 title')
        const renamed = await renameEntry(id, args.title)
        return `已重命名：${renamed.name} → ${renamed.title}`
      }
      if (action === 'doc_save') {
        if (typeof args?.doc !== 'string') throw new Error('doc_save 需要 doc')
        await writeFile(entry.docPath, String(args.doc), 'utf8')
        const quality = await docQualityOf(entry)
        entry.docCustomized = quality.docState === 'ok'
        entry.aiDoc = quality.docState === 'ok' ? 'done' : 'pending'
        entry.docState = quality.docState
        entry.docReason = quality.docReason
        entry.title = (await readDocTitle(entry.docPath)) ?? entry.title ?? null
        entry.updatedAt = nowISO()
        await saveIndex()
        return `文档已更新：${entry.docPath}`
      }
      throw new Error(`不支持 action：${action}`)
    },
  })

  // ---- auto archive watcher ----------------------------------------------
  if (autoArchive && watchDirs.length > 0) {
    const watcherStartedAt = Date.now()
    const timers = new Map()
    const watchers = []

    const scheduleArchive = (dir, fileName) => {
      if (typeof fileName !== 'string' || fileName === '') return
      const ext = extname(fileName).toLowerCase()
      if (!SCRIPT_EXTS.has(ext)) return
      const full = join(dir, fileName)
      if (full.startsWith(root)) return
      if (full.split(sep).some((part) => SKIP_DIRS.has(part))) return
      clearTimeout(timers.get(full))
      timers.set(
        full,
        setTimeout(async () => {
          timers.delete(full)
          try {
            const info = await stat(full)
            if (!info.isFile() || info.size === 0) return
            if (info.mtimeMs < watcherStartedAt - 60 * 1000) return
            const entry = await archiveFile(full)
            log('info', `auto-archived ${full} -> ${entry.filePath}`)
            applyAutoTitles().catch(() => {})
          } catch (error) {
            log('warn', `auto-archive skipped ${full}: ${error.message}`)
          }
        }, 1500),
      )
    }

    for (const dir of watchDirs) {
      try {
        const watcher = watch(dir, { recursive: true }, (_event, fileName) => scheduleArchive(dir, fileName))
        watcher.on('error', (error) => log('warn', `watch error ${dir}: ${error.message}`))
        watchers.push(watcher)
      } catch (error) {
        log('warn', `cannot watch ${dir}: ${error.message}`)
      }
    }

    ctx.effect(
      () => () => {
        for (const watcher of watchers) watcher.close()
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
      },
      'script-hub: watcher',
    )
  }

  // create the archive root + logs early so the panel shows a real path
  void mkdir(root, { recursive: true }).then(() => mkdir(logDir, { recursive: true })).catch(() => {})
  log('info', `ready (root=${root}, watch=${watchDirs.length})`)
}
