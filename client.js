/**
 * Script hub (client half) — by dan yikona <dansensei2024@outlook.com> · MIT
 * a sidebar entry plus a center-column page that lists the
 * archived scripts, shows their run state, and offers start / stop / log / doc.
 * 可以按需修改；改动或 bug 反馈欢迎发邮件。
 *
 * Route paths are DOCUMENT-RELATIVE (no leading slash): the harness serves the GUI
 * with `<base href="./">`, so a sub-path deployment would escape a root-absolute URL.
 */
window.__ModuleLoader__.load({
  id: 'dsh-script-hub',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = {
      list: 'api/dsh-script-hub/list',
      register: 'api/dsh-script-hub/register',
      start: 'api/dsh-script-hub/start',
      stop: 'api/dsh-script-hub/stop',
      logs: 'api/dsh-script-hub/logs',
      doc: 'api/dsh-script-hub/doc',
      remove: 'api/dsh-script-hub/delete',
      rename: 'api/dsh-script-hub/rename',
      hide: 'api/dsh-script-hub/hide',
      importScan: 'api/dsh-script-hub/import-scan',
      importRun: 'api/dsh-script-hub/import-run',
      importanceQueue: 'api/dsh-script-hub/importance-queue',
      importStatus: 'api/dsh-script-hub/import-status',
      aiStart: 'api/dsh-script-hub/ai-start',
      aiStatus: 'api/dsh-script-hub/ai-status',
      importanceRun: 'api/dsh-script-hub/importance-run',
      importanceStatus: 'api/dsh-script-hub/importance-status',
      autoname: 'api/dsh-script-hub/autoname',
      status: 'api/dsh-script-hub/status',
    }

    async function call(path, options) {
      const response = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        ...options,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const text = await response.text()
      let payload = {}
      try {
        payload = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
      }
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    const SCROLL_COLUMNS = '26px minmax(0, 1.75fr) 72px 92px 108px 52px 76px 108px 212px'

    const styles = {
      page: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        minHeight: 0,
        padding: '16px 18px 18px',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--dsw-font-family)',
        backgroundColor: 'var(--dsw-alias-bg-base, #16171b)',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #16171b) 94%, transparent)',
        backdropFilter: 'blur(18px) saturate(1.05)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.05)',
        overflow: 'hidden',
      },
      header: { display: 'flex', alignItems: 'center', gap: '10px', flex: 'none' },
      title: { margin: 0, fontSize: '16px', fontWeight: 700 },
      sub: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', fontFamily: 'var(--ds-font-family-code)' },
      spacer: { flex: 1 },
      modalMask: { position: 'fixed', inset: '0', zIndex: '80', background: 'rgba(6, 8, 12, 0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
      modalCard: { width: 'min(940px, 94vw)', maxHeight: '78vh', display: 'flex', flexDirection: 'column', borderRadius: '16px', border: '1px solid var(--dsw-alias-border-l1)', background: '#14161b', boxShadow: '0 24px 64px rgba(0,0,0,0.55)', overflow: 'hidden' },
      modalHead: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      modalBody: { overflow: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 auto' },
      modalFoot: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      importRow: { display: 'grid', gridTemplateColumns: '18px minmax(0, 1.2fr) 120px 116px 54px 58px minmax(0, 1.5fr)', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '8px', background: '#1b1e25' },
      importName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      importMeta: { color: '#8b93a7', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      importTag: { fontSize: '12px' },
      importPath: { color: '#6f7789', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      button: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '8px',
        padding: '5px 12px',
        fontSize: '12px',
        cursor: 'pointer',
      },
      mini: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '7px',
        padding: '3px 7px',
        fontSize: '12px',
        lineHeight: 1.2,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      miniPrimary: {
        border: 'none',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)',
        borderRadius: '7px',
        padding: '4px 9px',
        fontSize: '12px',
        lineHeight: 1.2,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      primary: {
        border: 'none',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)',
        borderRadius: '8px',
        padding: '6px 14px',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
      },
      toolbar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', flex: 'none' },
      filterBar: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        rowGap: '6px',
        flex: 'none',
        padding: '8px 10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #16171b) 84%, transparent)',
      },
      formBar: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        flex: 'none',
        padding: '8px 10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #16171b) 76%, transparent)',
      },
      input: {
        background: 'var(--dsw-specific-input-major)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        color: 'var(--dsw-alias-label-primary)',
        padding: '6px 10px',
        fontSize: '13px',
        outline: 'none',
        minWidth: '180px',
      },
      table: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '160px',
        flex: '1 1 auto',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #16171b) 88%, transparent)',
      },
      row: {
        display: 'grid',
        gridTemplateColumns: SCROLL_COLUMNS,
        gap: '8px',
        alignItems: 'center',
        boxSizing: 'border-box',
        padding: '8px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: '12.5px',
      },
      head: {
        position: 'sticky',
        top: 0,
        background: '#12141a',
        color: 'var(--dsw-alias-label-secondary)',
        fontWeight: 600,
        fontSize: '11.5px',
        zIndex: 3,
        boxShadow: '0 1px 0 var(--dsw-alias-border-l1)',
      },
      name: { fontFamily: 'var(--ds-font-family-code)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: {
        display: 'inline-block',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '999px',
        padding: '1px 8px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      dot: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', marginRight: '6px' },
      detail: {
        flex: '0 0 auto',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        height: 'clamp(150px, 34vh, 320px)',
        minHeight: '120px',
        overflow: 'hidden',
      },
      tabs: { display: 'flex', gap: '2px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flex: 'none' },
      tab: { background: 'transparent', border: 'none', borderBottom: '2px solid transparent', color: 'var(--dsw-alias-label-secondary)', padding: '7px 14px', fontSize: '13px', cursor: 'pointer' },
      tabActive: { color: 'var(--dsw-alias-label-primary)', borderBottomColor: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 },
      pre: {
        margin: 0,
        padding: '10px 12px',
        overflow: 'auto',
        flex: '1 1 auto',
        minHeight: 0,
        fontSize: '12px',
        lineHeight: 1.5,
        fontFamily: 'var(--ds-font-family-code)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: 'var(--dsw-alias-label-primary)',
      },
      textarea: {
        margin: '10px 12px',
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'auto',
        resize: 'none',
        background: 'var(--dsw-specific-input-major)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: '12px',
        lineHeight: 1.5,
        padding: '10px',
        outline: 'none',
      },
      banner: { borderRadius: '8px', padding: '7px 12px', fontSize: '12.5px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' },
      dangerGhost: { border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)', color: 'var(--dsw-alias-state-error-primary)', borderRadius: '8px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer' },
      danger: { border: '1px solid var(--dsw-alias-state-error-primary)', background: 'var(--dsw-alias-state-error-primary)', color: '#ffffff', borderRadius: '8px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer' },
      error: { borderRadius: '8px', padding: '7px 12px', fontSize: '12.5px', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      empty: { padding: '28px 12px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12.5px' },
    }

    const firstSegment = (value) => String(value ?? '').split('/')[0].trim()
    const importanceLabel = (level) => ({ high: '高', medium: '中', low: '低', pending: '待检测' }[level] ?? '—')
    const importanceColor = (level) => ({ high: '#e5534b', medium: '#e6b455', low: '#8b93a7', pending: '#7aa2f7' }[level] ?? 'var(--dsw-alias-label-secondary)')

    const fmtTime = (iso) => {
      if (typeof iso !== 'string' || iso === '') return '-'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '-'
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const fmtUptimeCompact = (ms) => {
      const value = Number(ms)
      if (!Number.isFinite(value) || value <= 0) return ''
      const sec = Math.floor(value / 1000)
      if (sec < 60) return `${sec}s`
      const min = Math.floor(sec / 60)
      if (min < 60) return `${min}m`
      const hour = Math.floor(min / 60)
      if (hour < 24) return `${hour}h`
      return `${Math.floor(hour / 24)}d`
    }

    const fmtUptime = (ms) => {
      const value = Number(ms)
      if (!Number.isFinite(value) || value <= 0) return ''
      const sec = Math.floor(value / 1000)
      if (sec < 60) return `${sec} 秒`
      const min = Math.floor(sec / 60)
      if (min < 60) return `${min} 分钟`
      const hour = Math.floor(min / 60)
      if (hour < 24) return `${hour} 小时 ${min % 60} 分`
      return `${Math.floor(hour / 24)} 天 ${hour % 24} 小时`
    }

    const runTitle = (entry) => {
      const taskBits = entry.task ? [`计划任务 ${entry.task}（${entry.taskStatus || '未知'}）`] : []
      if (entry.running) {
        if (entry.runState === 'task') return taskBits.join(' · ')
        if (entry.runState === 'proc') {
          const parts = [`进程 ${entry.procName || '在跑'}`, `pid ${entry.pid ?? '-'}`]
          const up = fmtUptime(entry.uptimeMs)
          if (up) parts.push(`已运行 ${up}`)
          parts.push('非本插件启动，按命令行匹配')
          return [...parts, ...taskBits].join(' · ')
        }
        const parts = [`pid ${entry.pid ?? '-'}`]
        if (entry.lastRun?.startedAt) parts.push(`启动于 ${fmtTime(entry.lastRun.startedAt)}`)
        const up = fmtUptime(entry.uptimeMs)
        if (up) parts.push(`已运行 ${up}`)
        if (entry.lastRun?.command) parts.push(entry.lastRun.command)
        return [...parts, ...taskBits].join(' · ')
      }
      const bits = []
      if (entry.exitedAt) bits.push(`退出于 ${fmtTime(entry.exitedAt)}`)
      if (entry.exitCode !== null && entry.exitCode !== undefined) bits.push(`code=${entry.exitCode}`)
      if (entry.exitReason) bits.push(entry.exitReason)
      const merged = [...bits, ...taskBits]
      return merged.length > 0 ? merged.join(' · ') : '尚未启动或已停止'
    }

    const runLabel = (entry) => (entry.running ? '运行中' : '未运行')

    function StatusDot({ running }) {
      return h('span', {
        style: { ...styles.dot, background: running ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' },
      })
    }

    function Panel() {
      const [state, setState] = React.useState({ loading: true, error: '', root: '', counts: {}, sessionCounts: {}, entries: [], running: 0, pending: 0, docNeed: 0, generated: [] })
      const [query, setQuery] = React.useState('')
      const [queryDraft, setQueryDraft] = React.useState('')
      const [menuFor, setMenuFor] = React.useState('')
      const [hideHidden, setHideHidden] = React.useState(true)
      const [collapseSame, setCollapseSame] = React.useState(false)
      const [scrollTop, setScrollTop] = React.useState(0)
      const [listH, setListH] = React.useState(420)
      const listRef = React.useRef(null)
      const [category, setCategory] = React.useState('')
      const [sessionFilter, setSessionFilter] = React.useState('')
      const [statusFilter, setStatusFilter] = React.useState('')
      const [selected, setSelected] = React.useState('')
      const [tab, setTab] = React.useState('doc')
      const [logText, setLogText] = React.useState('')
      const [docText, setDocText] = React.useState('')
      const [docDirty, setDocDirty] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [regPath, setRegPath] = React.useState('')
      const [regCategory, setRegCategory] = React.useState('')
      const [regSession, setRegSession] = React.useState('')
      const [confirmTarget, setConfirmTarget] = React.useState(null)
      const [renaming, setRenaming] = React.useState({ id: '', value: '', orig: '' })
      const [regDescription, setRegDescription] = React.useState('')
      const [importOpen, setImportOpen] = React.useState(false)
      const [importItems, setImportItems] = React.useState([])
      const [importSel, setImportSel] = React.useState([])
      const [importOneOff, setImportOneOff] = React.useState('all')
      const [importHideBackup, setImportHideBackup] = React.useState(false)
      const [importHideStale, setImportHideStale] = React.useState(false)
      const importOneOffCount = importItems.filter((item) => item.oneOff).length
      const importBackupCount = importItems.filter((item) => item.backup).length
      const importStaleCount = importItems.filter((item) => item.stale).length
      const importVisibleItems = importItems.filter((item) => {
        if (importOneOff === 'only' && !item.oneOff) return false
        if (importOneOff === 'hide' && item.oneOff) return false
        if (importHideBackup && item.backup) return false
        if (importHideStale && item.stale) return false
        return true
      })

      const importVisibleCount = importVisibleItems.length
      const [importBusy, setImportBusy] = React.useState('')
      const [importAiConfirm, setImportAiConfirm] = React.useState(false)
      const [importanceConfirm, setImportanceConfirm] = React.useState(false)
      const [importanceFilter, setImportanceFilter] = React.useState('')
      const [oneOffMode, setOneOffMode] = React.useState('all')
      const [hideBackup, setHideBackup] = React.useState(false)
      const [hideStale, setHideStale] = React.useState(false)
      const [startConfirm, setStartConfirm] = React.useState('')
      const [importMsg, setImportMsg] = React.useState('')
      const [aiConfirm, setAiConfirm] = React.useState(false)
      const [aiState, setAiState] = React.useState({ active: false, done: 0, total: 0, sessionId: '', error: '' })
      const [aiMsg, setAiMsg] = React.useState('')
      const [impConfirm, setImpConfirm] = React.useState(false)
      const [impState, setImpState] = React.useState({ active: false, done: 0, total: 0, missing: 0, sessionId: '', error: '' })
      const [impMsg, setImpMsg] = React.useState('')
      const [picked, setPicked] = React.useState(() => new Set())
      const [bulkMenu, setBulkMenu] = React.useState(false)
      const [bulkBusy, setBulkBusy] = React.useState('')
      const [bulkMsg, setBulkMsg] = React.useState('')
      const [bulkConfirmDel, setBulkConfirmDel] = React.useState(false)
      const [sortBy, setSortBy] = React.useState('default')
      const [docFilter, setDocFilter] = React.useState('')
      const [showGenerated, setShowGenerated] = React.useState(false)
      const [nameMsg, setNameMsg] = React.useState('')
      const [statusMsg, setStatusMsg] = React.useState('')
      const [probeRows, setProbeRows] = React.useState([])


      const refresh = React.useCallback(async () => {
        try {
          const payload = await call(API.list)
          setState({ loading: false, error: '', root: payload.root, counts: payload.counts ?? {}, sessionCounts: payload.sessionCounts ?? {}, entries: payload.entries ?? [], running: payload.running ?? 0, pending: payload.pending ?? 0, docNeed: payload.docNeed ?? 0, generated: payload.generatedSessions ?? [] })
        } catch (error) {
          setState((prev) => ({ ...prev, loading: false, error: String(error.message || error) }))
        }
      }, [])

      React.useEffect(() => {
        if (queryDraft === query) return undefined
        const timer = setTimeout(() => setQuery(queryDraft), 200)
        return () => clearTimeout(timer)
      }, [queryDraft, query])

      React.useEffect(() => {
        void refresh()
        const timer = setInterval(() => void refresh(), 10000)
        return () => clearInterval(timer)
      }, [refresh])

      // 列表可视高度随窗口/容器变化，虚拟滚动窗口据此重算
      React.useEffect(() => {
        const node = listRef.current
        if (!node || typeof ResizeObserver === 'undefined') return undefined
        const apply = () => {
          const next = Math.max(120, Math.round(node.clientHeight || 0) || 420)
          setListH((prev) => (Math.abs(prev - next) > 4 ? next : prev))
        }
        apply()
        const observer = new ResizeObserver(apply)
        observer.observe(node)
        window.addEventListener('resize', apply)
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', apply)
        }
      }, [state.entries.length])

      const entries = state.entries
      const categories = Object.keys(state.counts).sort()
      const sessions = Object.keys(state.sessionCounts ?? {}).sort()
      const current = entries.find((entry) => entry.id === selected) ?? null

      const sameInfo = (() => {
        const LAUNCHER = new Set(['.cmd', '.bat', '.vbs', '.sh'])
        const map = new Map()
        for (const entry of entries) {
          const base = String(entry.name || '').replace(/\.[^.]+$/, '').toLowerCase()
          if (!map.has(base)) map.set(base, [])
          map.get(base).push(entry)
        }
        const primary = new Map()
        const dupBase = new Set()
        for (const [base, items] of map) {
          if (items.length < 2) continue
          dupBase.add(base)
          const rank = (entry) => (LAUNCHER.has(entry.ext) ? 2 : 1)
          const sorted = items.slice().sort((a, b) => rank(a) - rank(b)
            || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
          primary.set(sorted[0].id, items.length)
        }
        return { primary, dupBase }
      })()
      const sameGroups = sameInfo.primary

      const visible = entries.filter((entry) => {
        if (collapseSame && sameInfo.dupBase.size > 0) {
          const base = String(entry.name || '').replace(/\.[^.]+$/, '').toLowerCase()
          if (sameInfo.dupBase.has(base) && !sameInfo.primary.has(entry.id)) return false
        }
        if (category !== '' && entry.category !== category) return false
        if (sessionFilter !== '' && firstSegment(entry.sessionTitle || entry.session || '未标注') !== sessionFilter) return false
        if (statusFilter === 'running' && !entry.running) return false
        if (statusFilter === 'stopped' && entry.running) return false
        if (statusFilter === 'scheduled' && !entry.task) return false
        if (importanceFilter !== '' && (entry.importance || '') !== importanceFilter) return false
        if (docFilter === 'need' && entry.docState === 'ok') return false
        if (docFilter === 'ok' && entry.docState !== 'ok') return false
        if (oneOffMode === 'only' && !entry.oneOff) return false
        if (oneOffMode === 'hide' && entry.oneOff) return false
        if (hideBackup && entry.backup) return false
        if (hideStale && entry.stale) return false
        if (hideHidden && entry.hidden) return false
        if (query.trim() !== '') {
          const needle = query.trim().toLowerCase()
          const haystack = `${entry.title || ''} ${entry.name} ${entry.category} ${entry.project} ${entry.session} ${entry.description} ${entry.srcPath}`.toLowerCase()
          if (!haystack.includes(needle)) return false
        }
        return true
      })

      const loadDoc = React.useCallback(async (id) => {
        try {
          const payload = await call(`${API.doc}?id=${encodeURIComponent(id)}`)
          setDocText(payload.text ?? '')
          setDocDirty(false)
        } catch (error) {
          setDocText(`（读取文档失败：${error.message || error}）`)
        }
      }, [])

      const loadLogs = React.useCallback(async (id) => {
        try {
          const payload = await call(`${API.logs}?id=${encodeURIComponent(id)}&lines=400`)
          setLogText(payload.text === '' ? '（暂无日志，脚本可能还没启动过）' : payload.text)
        } catch (error) {
          setLogText(`（读取日志失败：${error.message || error}）`)
        }
      }, [])

      const commitRename = React.useCallback(
        async (id, value, orig) => {
          const title = String(value ?? '').trim()
          setRenaming({ id: '', value: '', orig: '' })
          if (title === '' || title === orig) return
          try {
            const payload = await call(API.rename, { method: 'POST', body: JSON.stringify({ id, title }) })
            setNotice(`已重命名为「${payload.entry.title}」`)
            await refresh()
          } catch (error) {
            setNotice(`重命名失败：${error.message || error}`)
          }
        },
        [refresh],
      )

      const selectEntry = React.useCallback(
        (id) => {
          setSelected(id)
          setDocText('')
          setLogText('')
          if (tab === 'doc') void loadDoc(id)
          else void loadLogs(id)
        },
        [tab, loadDoc, loadLogs],
      )

      React.useEffect(() => {
        if (selected === '') return undefined
        if (tab === 'log') {
          void loadLogs(selected)
          const timer = setInterval(() => void loadLogs(selected), 5000)
          return () => clearInterval(timer)
        }
        void loadDoc(selected)
        return undefined
      }, [selected, tab, loadDoc, loadLogs])

      const act = async (id, action) => {
        setBusy(`${id}:${action}`)
        setNotice('')
        try {
          await call(action === 'start' ? API.start : API.stop, { method: 'POST', body: { id } })
          setNotice(action === 'start' ? '已启动' : '已停止')
          await refresh()
        } catch (error) {
          setNotice(`操作失败：${error.message || error}`)
        } finally {
          setBusy('')
        }
      }

      const askRemove = (entry) => {
        setNotice('')
        setConfirmTarget(entry)
      }

      const doRemove = async () => {
        const entry = confirmTarget
        if (!entry) return
        setBusy(`${entry.id}:remove`)
        try {
          await call(API.remove, { method: 'POST', body: { id: entry.id } })
          if (selected === entry.id) setSelected('')
          setNotice(`已删除 ${entry.name}`)
          setConfirmTarget(null)
          await refresh()
        } catch (error) {
          setNotice(`删除失败：${error.message || error}`)
        } finally {
          setBusy('')
        }
      }

      const toggleHidden = async (entry) => {
        const next = !entry.hidden
        setBusy(`${entry.id}:hide`)
        try {
          await call(API.hide, { method: 'POST', body: { id: entry.id, hidden: next } })
          setNotice(next ? `已隐藏 ${entry.title || entry.name}` : `已取消隐藏 ${entry.title || entry.name}`)
          await refresh()
        } catch (error) {
          setNotice(`操作失败：${error.message || error}`)
        } finally {
          setBusy('')
        }
      }

      const copyPath = async (entry) => {
        try {
          await navigator.clipboard.writeText(entry.filePath)
          setNotice(`已复制路径：${entry.filePath}`)
        } catch {
          setNotice(`路径：${entry.filePath}`)
        }
      }

      const bulkList = () => entries.filter((entry) => picked.has(entry.id))

      const runBulk = async (kind) => {
        setBulkMenu(false)
        const targets = bulkList()
        if (targets.length === 0) {
          setNotice('先在左侧勾选框里选中脚本')
          return
        }
        if (kind === 'delete') {
          setBulkConfirmDel(true)
          return
        }
        const label = { start: '批量启动', stop: '批量停止', hide: '批量隐藏', unhide: '批量取消隐藏', copy: '批量复制路径', ai: '批量补文档', importance: '批量检测重要性' }[kind] ?? '批量操作'
        setBulkBusy(kind)
        setBulkMsg('')
        setNotice('')
        let ok = 0
        let fail = 0
        try {
          if (kind === 'start' || kind === 'stop') {
            for (const entry of targets) {
              try {
                await call(kind === 'start' ? API.start : API.stop, { method: 'POST', body: { id: entry.id } })
                ok += 1
              } catch (error) {
                fail += 1
              }
              setBulkMsg(`${label}：${ok + fail}/${targets.length}`)
            }
          } else if (kind === 'hide' || kind === 'unhide') {
            for (const entry of targets) {
              try {
                await call(API.hide, { method: 'POST', body: { id: entry.id, hidden: kind === 'hide' } })
                ok += 1
              } catch (error) {
                fail += 1
              }
              setBulkMsg(`${label}：${ok + fail}/${targets.length}`)
            }
          } else if (kind === 'copy') {
            const text = targets.map((entry) => entry.filePath).join('\n')
            try {
              await navigator.clipboard.writeText(text)
              ok = targets.length
            } catch (clipError) {
              setBulkMsg('剪贴板不可用，路径如下：')
              setNotice(text)
              ok = 0
            }
          } else if (kind === 'ai') {
            await call(API.aiStart, { method: 'POST', body: { ids: targets.map((entry) => entry.id) } })
            ok = targets.length
          } else if (kind === 'importance') {
            await call(API.importanceRun, { method: 'POST', body: { ids: targets.map((entry) => entry.id) } })
            ok = targets.length
          }
          setBulkMsg(`${label}：成功 ${ok}${fail > 0 ? `，失败 ${fail}` : ''}`)
          if (kind === 'ai') setNotice('已提交文档补全，进度见上方横幅')
          if (kind === 'importance') setNotice('已提交重要性检测，进度见上方横幅')
          await refresh()
        } catch (error) {
          setBulkMsg(`${label}失败：${error.message || error}`)
        } finally {
          setBulkBusy('')
        }
      }

      const doBulkRemove = async () => {
        const targets = bulkList()
        if (targets.length === 0) {
          setBulkConfirmDel(false)
          return
        }
        setBulkBusy('delete')
        setBulkMsg('')
        let ok = 0
        let fail = 0
        const removed = new Set(picked)
        for (const entry of targets) {
          try {
            await call(API.remove, { method: 'POST', body: { id: entry.id } })
            ok += 1
            removed.delete(entry.id)
            if (selected === entry.id) setSelected('')
          } catch (error) {
            fail += 1
          }
          setBulkMsg(`批量删除：${ok + fail}/${targets.length}`)
        }
        setPicked(removed)
        setBulkConfirmDel(false)
        setBulkBusy('')
        setBulkMsg(`批量删除：成功 ${ok}${fail > 0 ? `，失败 ${fail}` : ''}`)
        await refresh()
      }

      const saveDoc = async () => {
        if (!current) return
        setBusy(`${current.id}:save`)
        try {
          await call(API.doc, { method: 'POST', body: { id: current.id, text: docText } })
          setDocDirty(false)
          setNotice('文档已保存')
          await refresh()
        } catch (error) {
          setNotice(`保存失败：${error.message || error}`)
        } finally {
          setBusy('')
        }
      }

      const register = async () => {
        if (regPath.trim() === '') {
          setNotice('请先填写脚本路径')
          return
        }
        setBusy('register')
        try {
          const payload = await call(API.register, {
            method: 'POST',
            body: { path: regPath.trim(), category: regCategory.trim() || undefined, session: regSession.trim() || undefined, description: regDescription.trim() || undefined },
          })
          setNotice(`已归档：${payload.entry?.filePath ?? ''}`)
          setRegPath('')
          setRegDescription('')
          await refresh()
        } catch (error) {
          setNotice(`归档失败：${error.message || error}`)
        } finally {
          setBusy('')
        }
      }

      const cell = (content, extra = {}) => h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...extra } }, content)

      const filterGroup = (() => {
            const oneOffCount = entries.filter((entry) => entry.oneOff).length
            const hiddenCount = entries.filter((entry) => entry.hidden).length
            const base = { ...styles.mini }
            const active = (mode) => (oneOffMode === mode ? { ...base, borderColor: '#e5534b', color: '#e5534b', background: 'rgba(229,83,75,0.14)' } : base)
            return h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', rowGap: '4px', minWidth: 0 }, title: '一次性脚本：命名像 check/diag/probe、含硬编码日期，或注释写明一次性' },
              h('span', { style: { ...styles.sub, marginRight: '2px' } }, '一次性'),
              h('button', { style: active('all'), onClick: () => setOneOffMode('all') }, '全部'),
              h('button', { style: active('only'), onClick: () => setOneOffMode('only') }, `只看（${oneOffCount}）`),
              h('button', { style: active('hide'), onClick: () => setOneOffMode('hide') }, '隐藏'),
              h('span', { style: { ...styles.sub, margin: '0 6px 0 10px' } }, '备份'),
              h('button', {
                style: hideBackup ? { ...styles.mini, borderColor: '#e5534b', color: '#e5534b', background: 'rgba(229,83,75,0.14)' } : styles.mini,
                title: '隐藏疑似备份脚本：文件名含 bak/backup/copy/副本/备份，或位于备份目录',
                onClick: () => setHideBackup(!hideBackup),
              }, hideBackup ? '已隐藏' : '显示中'),
              h('span', { style: { ...styles.sub, margin: '0 6px 0 10px' } }, '旧版'),
              h('button', {
                style: hideStale ? { ...styles.mini, borderColor: '#e5534b', color: '#e5534b', background: 'rgba(229,83,75,0.14)' } : styles.mini,
                title: '隐藏疑似旧版脚本：文件名含 old/legacy/v1，或与同名脚本相比是较旧的那份',
                onClick: () => setHideStale(!hideStale),
              }, hideStale ? '已隐藏' : '显示中'),
              h('span', { style: { ...styles.sub, margin: '0 6px 0 10px' } }, '同名'),
              h('button', {
                style: collapseSame ? { ...styles.mini, borderColor: '#7aa2f7', color: '#7aa2f7', background: 'rgba(122,162,247,0.14)' } : styles.mini,
                title: '把同名的启动壳（.cmd/.vbs）与主体（.py/.ps1）合成一行，只显示主体',
                onClick: () => setCollapseSame(!collapseSame),
              }, collapseSame ? `已合并 (${sameGroups.size})` : '未合并'),
              h('span', { style: { ...styles.sub, margin: '0 6px 0 10px' } }, '隐藏'),
              h('button', {
                style: hideHidden ? { ...styles.mini, borderColor: '#e5534b', color: '#e5534b', background: 'rgba(229,83,75,0.14)' } : styles.mini,
                title: '手动隐藏的脚本：在行尾「更多」里隐藏后不显示，这里可以放出来',
                onClick: () => setHideHidden(!hideHidden),
              }, hideHidden ? `已隐藏 (${hiddenCount})` : `显示中 (${hiddenCount})`),
            )
          })()

      const headerRow = h(
        'div',
        { style: { ...styles.row, ...styles.head } },
        h('input', {
          type: 'checkbox',
          title: '全选当前列表',
          style: { margin: 0, cursor: 'pointer' },
          checked: visible.length > 0 && visible.every((entry) => picked.has(entry.id)),
          onChange: (event) => {
            event.stopPropagation()
            setPicked((prev) => {
              const next = new Set(prev)
              if (event.target.checked) visible.forEach((entry) => next.add(entry.id))
              else visible.forEach((entry) => next.delete(entry.id))
              return next
            })
          },
        }),
        cell(h('span', { title: '右键可重命名（Enter 保存 / Esc 取消）' }, '脚本名称')),
        cell('类别'),
        cell('项目'),
        cell('会话'),
        cell('重要'),
        cell('状态'),
        cell('最近启动'),
        h('div', { style: { textAlign: 'right' } }, '操作'),
      )

      const sortedVisible = (() => {
        const list = visible.slice()
        if (sortBy === 'title') list.sort((a, b) => String(a.title || a.name).localeCompare(String(b.title || b.name), 'zh-Hans-CN'))
        else if (sortBy === 'importance') {
          const rank = { high: 0, medium: 1, low: 2, pending: 3 }
          list.sort((a, b) => (rank[a.importance] ?? 9) - (rank[b.importance] ?? 9))
        } else if (sortBy === 'doc') {
          const rank = { missing: 0, skeleton: 1, thin: 2, ok: 3 }
          list.sort((a, b) => (rank[a.docState] ?? 9) - (rank[b.docState] ?? 9))
        } else if (sortBy === 'recent') {
          list.sort((a, b) => String(b.lastRun?.startedAt ?? '').localeCompare(String(a.lastRun?.startedAt ?? '')))
        } else if (sortBy === 'created') {
          list.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        }
        return list
      })()
      const ROW_H = 38
      const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - 6)
      const endIdx = Math.min(sortedVisible.length, Math.ceil((scrollTop + listH) / ROW_H) + 6)
      const windowed = sortedVisible.slice(startIdx, endIdx)
      const rows = windowed.map((entry, idx) => {
        const menuUp = idx > windowed.length / 2
        const selectedNow = entry.id === selected
        return h(
          'div',
          {
            key: entry.id,
            style: { ...styles.row, height: `${ROW_H}px`, paddingTop: 0, paddingBottom: 0, cursor: 'pointer', background: selectedNow ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent' },
            onClick: () => selectEntry(entry.id),
            title: entry.srcPath,
          },
          h('input', {
            type: 'checkbox',
            style: { margin: 0, cursor: 'pointer' },
            checked: picked.has(entry.id),
            onClick: (event) => event.stopPropagation(),
            onChange: (event) => {
              event.stopPropagation()
              setPicked((prev) => {
                const next = new Set(prev)
                if (event.target.checked) next.add(entry.id)
                else next.delete(entry.id)
                return next
              })
            },
          }),
          h(
            'div',
            {
              style: styles.name,
              title: `${entry.name}\n${entry.filePath}`,
              onContextMenu: (event) => {
                event.preventDefault()
                event.stopPropagation()
                const currentTitle = entry.title || entry.name.replace(/\.[^.]+$/, '')
                setRenaming({ id: entry.id, value: currentTitle, orig: currentTitle })
              },
            },
            renaming.id === entry.id
              ? h('input', {
                  style: { ...styles.input, minWidth: 0, width: '100%', padding: '3px 6px', fontSize: '12.5px' },
                  value: renaming.value,
                  autoFocus: true,
                  onClick: (event) => event.stopPropagation(),
                  onChange: (event) => setRenaming({ ...renaming, value: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void commitRename(entry.id, event.target.value, renaming.orig)
                    if (event.key === 'Escape') setRenaming({ id: '', value: '', orig: '' })
                  },
                  onBlur: (event) => void commitRename(entry.id, event.target.value, renaming.orig),
                })
              : h(
                  'span',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } },
                    entry.title || entry.name.replace(/\.[^.]+$/, ''),
                    entry.title ? null : h('span', { style: { ...styles.sub, marginLeft: '6px' } }, '未命名'),
                  ),
                  entry.oneOff
                    ? h('span', { title: `一次性脚本：${entry.oneOffReason || ''}`, style: { flex: 'none', width: '6px', height: '6px', borderRadius: '50%', background: '#e5534b' } })
                    : null,
                  entry.backup
                    ? h('span', { title: `备份脚本：${entry.backupReason || ''}`, style: { flex: 'none', width: '6px', height: '6px', borderRadius: '50%', background: '#e6b455' } })
                    : null,
                  entry.stale
                    ? h('span', { title: `旧版脚本：${entry.staleReason || ''}`, style: { flex: 'none', width: '6px', height: '6px', borderRadius: '50%', background: '#6f7789' } })
                    : null,
                  sameGroups.has(entry.id)
                    ? h('span', { title: '同名脚本合并显示：关掉筛选栏的「同名」开关可看全部', style: { flex: 'none', fontSize: '11px', color: '#7aa2f7' } }, `同名 ${sameGroups.get(entry.id)}`)
                    : null,
                  entry.docState && entry.docState !== 'ok'
                    ? h('span', { title: `文档待补全：${entry.docReason || entry.docState}`, style: { flex: 'none', fontSize: '11px', color: '#e6b455' } }, entry.docState === 'missing' ? '无文档' : '文档空')
                    : null,
                ),
          ),
          cell(h('span', { style: styles.badge }, entry.category)),
          cell(entry.project),
          cell(firstSegment(entry.sessionTitle || entry.session || '未标注'), { color: 'var(--dsw-alias-label-secondary)' }),
          cell(importanceLabel(entry.importance), { color: importanceColor(entry.importance), fontWeight: entry.importance === 'high' ? 600 : 400 }),
          cell(
            h('span', { title: runTitle(entry), style: { color: entry.running ? '#3fb950' : 'var(--dsw-alias-label-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px' } },
              h(StatusDot, { running: entry.running }),
              runLabel(entry),
            ),
          ),
          cell(fmtTime(entry.lastRun?.startedAt)),
          h(
            'div',
            { style: { display: 'flex', gap: '5px', justifyContent: 'flex-end', flexWrap: 'nowrap', position: 'relative' }, onClick: (event) => event.stopPropagation() },
            entry.runState === 'running'
              ? h('button', { style: styles.mini, disabled: busy === `${entry.id}:stop`, onClick: () => act(entry.id, 'stop') }, '停止')
              : entry.running
                ? h('button', {
                    style: { ...styles.mini, opacity: 0.55 },
                    title: entry.runState === 'task'
                      ? `由计划任务 ${entry.task || ''} 拉起，请用任务计划程序停（Stop-ScheduledTask）`
                      : `进程 pid ${entry.pid ?? ''} 不是插件启动的，为避免误杀这里不提供停止`,
                    disabled: true,
                  }, '停止')
                : h('button', {
                  style: styles.miniPrimary,
                  disabled: busy === `${entry.id}:start`,
                  onClick: (event) => {
                    event.stopPropagation()
                    if (entry.importance === 'high' && startConfirm !== entry.id) {
                      setStartConfirm(entry.id)
                      return
                    }
                    setStartConfirm('')
                    act(entry.id, 'start')
                  },
                }, '启动'),
            h('button', { style: styles.mini, disabled: busy === `${entry.id}:remove`, onClick: () => askRemove(entry) }, '删除'),
            h('button', {
              style: menuFor === entry.id ? { ...styles.mini, borderColor: '#7aa2f7', color: '#7aa2f7' } : styles.mini,
              title: '更多操作：说明 / 日志 / 文档 / 隐藏 / 复制路径',
              onClick: () => setMenuFor(menuFor === entry.id ? '' : entry.id),
            }, '更多'),
            menuFor === entry.id
              ? h('div', {
                  style: {
                    position: 'absolute',
                    right: 0,
                    ...(menuUp ? { bottom: '100%', marginBottom: '4px' } : { top: '100%', marginTop: '4px' }),
                    minWidth: '132px',
                    zIndex: 40,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                    padding: '5px',
                    borderRadius: '10px',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    background: '#14161b',
                    boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                  },
                },
                  [
                    ['说明', () => { setSelected(entry.id); setTab('note') }],
                    ['日志', () => { setSelected(entry.id); setTab('log') }],
                    ['文档', () => { setSelected(entry.id); setTab('doc') }],
                    [entry.hidden ? '取消隐藏' : '隐藏', () => { void toggleHidden(entry) }],
                    ['复制路径', () => { void copyPath(entry) }],
                  ].map(([label, run]) => h('button', {
                    key: label,
                    style: { ...styles.mini, textAlign: 'left', border: 'none', background: 'transparent', justifyContent: 'flex-start' },
                    onClick: () => { setMenuFor(''); run() },
                  }, label)),
                )
              : null,
          ),
        )
      })

      const detail = current
        ? h(
            'div',
            { style: styles.detail },
            h(
              'div',
              { style: styles.tabs },
              h('button', { style: { ...styles.tab, ...(tab === 'note' ? styles.tabActive : {}) }, onClick: () => setTab('note') }, '说明'),
              h('button', { style: { ...styles.tab, ...(tab === 'doc' ? styles.tabActive : {}) }, onClick: () => setTab('doc') }, '文档'),
              h('button', { style: { ...styles.tab, ...(tab === 'log' ? styles.tabActive : {}) }, onClick: () => setTab('log') }, '日志'),
              h('div', { style: styles.spacer }),
              h('span', { style: { ...styles.sub, alignSelf: 'center', paddingRight: '10px' } }, `${current.title || current.name} · ${current.category} / ${current.project} / ${current.sessionTitle || current.session || '未标注'} · ${current.ext}${current.docState && current.docState !== 'ok' ? ` · 文档待补全（${current.docReason || current.docState}）` : ''}`),
              tab === 'doc'
                ? h('button', { style: { ...styles.button, margin: '4px 6px', opacity: docDirty ? 1 : 0.5 }, disabled: !docDirty || busy === `${current.id}:save`, onClick: saveDoc }, '保存')
                : tab === 'log'
                  ? h('button', { style: { ...styles.button, margin: '4px 6px' }, onClick: () => loadLogs(current.id) }, '刷新')
                  : h('button', { style: { ...styles.button, margin: '4px 6px' }, onClick: () => refresh() }, '刷新'),
            ),
            tab === 'note'
              ? h(
                  'div',
                  { style: { padding: '14px 16px', overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' } },
                  h('div', { style: { fontSize: '14px', lineHeight: '1.7' } }, current.blurb || '（脚本内没有写作用说明）'),
                  h(
                    'div',
                    { style: { ...styles.sub, lineHeight: '1.7' } },
                    current.blurb
                      ? `来源：${current.blurbSource || '自动提取'}；如需改写，在脚本头部加一行 「# 作用：一句话」。`
                      : '在脚本开头加一行 「# 作用：一句话」，面板会自动读出来；也可以让我在对应会话里补写。',
                  ),
                  h('div', { style: { ...styles.sub } }, `真实文件名：${current.realName || current.name}`),
                  h('div', { style: { ...styles.sub } }, `路径：${current.filePath}`),
                )
              : tab === 'doc'
              ? h('textarea', {
                  style: styles.textarea,
                  value: docText,
                  spellCheck: false,
                  onChange: (event) => {
                    setDocText(event.target.value)
                    setDocDirty(true)
                  },
                })
              : h('pre', { style: styles.pre }, logText),
          )
        : h('div', { style: styles.empty }, '选择上方任意脚本查看文档或日志。')

      const openImport = React.useCallback(async () => {
        setImportOpen(true)
        setImportMsg('正在扫描历史脚本…')
        setImportAiConfirm(false)
        try {
          const payload = await call(API.importScan)
          const items = payload.candidates ?? []
          setImportItems(items)
          setImportSel(items.filter((item) => !item.archived).map((item) => item.key))
          setImportMsg(`扫描完成：${items.length} 个候选脚本，来自 ${(payload.roots ?? []).length} 个目录`)
        } catch (error) {
          setImportMsg(`扫描失败：${error.message || error}`)
        }
      }, [])

      const toggleImport = (key) => {
        setImportSel((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
      }

      const runImportance = async () => {
        if (importSel.length === 0) {
          setImportMsg('先勾选要检测重要性的脚本')
          return
        }
        if (!importanceConfirm) {
          setImportanceConfirm(true)
          return
        }
        setImportBusy('importance')
        setImportMsg('正在归档并排队…')
        try {
          const ids = []
          for (const part of chunk(importSel, 50)) {
            const payload = await call(API.importRun, { method: 'POST', body: { keys: part, ai: false } })
            for (const item of payload.results ?? []) if (item.ok && item.id) ids.push(item.id)
            setImportMsg(`归档中：已处理 ${ids.length} / ${importSel.length}…`)
          }
          let queued = 0
          for (const part of chunk(ids, 200)) {
            const payload = await call(API.importanceQueue, { method: 'POST', body: { ids: part } })
            queued += payload.queued ?? 0
          }
          setImportanceConfirm(false)
          setImportMsg(`已排队 ${queued} 个脚本：新建一个对话并说「处理脚本中心重要性队列」，AI 会读取历史会话给出高/中/低`)
          await refresh()
        } catch (error) {
          setImportMsg(`排队失败：${error.message || error}`)
        } finally {
          setImportBusy('')
        }
      }

      const chunk = (list, size) => {
        const out = []
        for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
        return out
      }

      const aiTimer = React.useRef(null)

      const pollAi = async () => {
        try {
          const status = await call(API.aiStatus)
          setAiState({ active: !!status.active, done: status.done ?? 0, total: status.total ?? 0, sessionId: status.sessionId ?? '', error: status.error ?? '' })
          if (status.active) {
            setImportMsg(`AI 补全中：${status.done} / ${status.total} 已写入（后台会话 ${String(status.sessionId || '').slice(0, 8)}，可关闭弹窗）`)
            aiTimer.current = setTimeout(() => { void pollAi() }, 4000)
            return
          }
          const tail = status.error ? `（${status.error}）` : ''
          setImportMsg(`AI 补全结束：${status.done} / ${status.total} 已写入${tail}`)
          if ((status.total ?? 0) > 0) setAiMsg(`AI 补全结束：${status.done}/${status.total} 已写入${tail}`)
          await refresh()
        } catch (error) {
          setImportMsg(`AI 状态查询失败：${error.message || error}`)
        }
      }

      React.useEffect(() => () => {
        if (aiTimer.current) clearTimeout(aiTimer.current)
      }, [])

      const runImport = async (ai) => {
        if (importSel.length === 0) {
          setImportMsg('先勾选要导入的脚本')
          return
        }
        if (ai && !importAiConfirm) {
          setImportAiConfirm(true)
          return
        }
        setImportBusy(ai ? 'ai' : 'plain')
        setImportMsg(ai ? `正在导入 ${importSel.length} 个脚本…` : `正在导入 ${importSel.length} 个脚本…`)
        const results = []
        try {
          for (const part of chunk(importSel, 50)) {
            const payload = await call(API.importRun, { method: 'POST', body: { keys: part, ai } })
            results.push(...(payload.results ?? []))
            setImportMsg(`导入中：已处理 ${results.length} / ${importSel.length}…`)
          }
          const ok = results.filter((item) => item.ok).length
          const failed = results.length - ok
          setImportMsg(`导入完成：成功 ${ok} 个${failed > 0 ? `，失败 ${failed} 个` : ''}`)
          setImportAiConfirm(false)
          await refresh()
          if (ai) {
            const ids = results.filter((item) => item.ok && item.id).map((item) => item.id)
            if (ids.length > 0) {
              const started = await call(API.aiStart, { method: 'POST', body: { ids } })
              setImportMsg(`已启动 AI 补全：${started.total} 个脚本，后台会话 ${String(started.sessionId || '').slice(0, 8)} 正在生成…`)
              void pollAi()
            }
          }
        } catch (error) {
          setImportMsg(`导入失败：${error.message || error}`)
        } finally {
          setImportBusy('')
        }
      }

      const runAi = React.useCallback(async () => {
        setAiConfirm(false)
        setBusy('ai')
        try {
          const payload = await call(API.aiStart, { method: 'POST', body: { ids: [] } })
          setAiMsg('')
          setAiState({ active: true, done: 0, total: payload.total, sessionId: '', error: '' })
          void pollAi()
        } catch (error) {
          setAiMsg(`启动失败：${String(error.message || error)}`)
        } finally {
          setBusy('')
        }
      }, [pollAi])

      const impTimer = React.useRef(null)

      const pollImportance = async () => {
        try {
          const status = await call(API.importanceStatus)
          setImpState({ active: !!status.active, done: status.done ?? 0, total: status.total ?? 0, missing: status.missing ?? 0, sessionId: status.sessionId ?? '', error: status.error ?? '' })
          if (status.active) {
            impTimer.current = setTimeout(() => { void pollImportance() }, 4000)
            return
          }
          const tail = status.error ? '（' + status.error + '）' : ''
          setImpMsg('重要性检测结束：' + status.done + ' / ' + status.total + ' 已写回，仍缺 ' + status.missing + tail)
          await refresh()
          await loadImportScan()
        } catch (error) {
          setImpMsg('重要性状态查询失败：' + (error.message || error))
        }
      }

      React.useEffect(() => () => {
        if (impTimer.current) clearTimeout(impTimer.current)
      }, [])

      const runImportanceAll = async () => {
        setImpConfirm(false)
        setBusy('importance')
        try {
          const payload = await call(API.importanceRun, { method: 'POST', body: { ids: [...picked] } })
          setImpMsg('')
          setImpState({ active: true, done: 0, total: payload.total, missing: payload.total, sessionId: '', error: '' })
          void pollImportance()
        } catch (error) {
          setImpMsg('启动重要性检测失败：' + String(error.message || error))
        } finally {
          setBusy('')
        }
      }

      const missingImportance = entries.filter((entry) => !entry.importance || entry.importance === 'pending').length
      const impTargets = picked.size > 0 ? picked.size : missingImportance

      return h(
        'div',
        { style: styles.page, 'data-dsh-script-hub-view': '' },
        h(
          'div',
          { style: styles.header },
          h('h2', { style: styles.title }, '脚本中心'),
          h('span', { style: styles.sub }, `${state.running} 运行中 / ${entries.length} 个脚本${(state.docNeed || state.pending) > 0 ? ` · ${state.docNeed || state.pending} 个文档待补全` : ''}`),
          h('div', { style: styles.spacer }),
          h('button', {
            style: (state.docNeed || state.pending) > 0
              ? { ...styles.button, borderColor: '#7aa2f7', color: '#7aa2f7' }
              : { ...styles.button, opacity: 0.45, cursor: 'default' },
            disabled: (state.docNeed || state.pending) === 0,
            title: '插件会直接新建一个后台会话，用当前账号模型读取脚本并写 .md（消耗 token）',
            onClick: () => { if ((state.docNeed || state.pending) > 0) setAiConfirm(true) },
          }, aiState.active ? `AI 补全中 ${aiState.done}/${aiState.total}` : ((state.docNeed || state.pending) > 0 ? `AI 补全文档 (${state.docNeed || state.pending})` : 'AI 补全文档')),
          h('button', {
            style: impState.active
              ? { ...styles.button, borderColor: '#7aa2f7', color: '#7aa2f7' }
              : (missingImportance > 0
                ? { ...styles.button, borderColor: '#e6b455', color: '#e6b455' }
                : { ...styles.button, opacity: 0.45, cursor: 'default' }),
            disabled: impState.active || impTargets === 0,
            title: '插件新建后台会话，读取脚本与所属会话上下文判定 high/medium/low（消耗 token）',
            onClick: () => { if (!impState.active && impTargets > 0) setImpConfirm(true) },
          }, impState.active ? `检测中 ${impState.done}/${impState.total}` : (picked.size > 0 ? `检测选中 (${picked.size})` : (missingImportance > 0 ? `检测重要性 (${missingImportance})` : '重要性已全'))),
          h(
            'div',
            { style: { position: 'relative' } },
            h('button', {
              style: picked.size > 0
                ? { ...styles.button, borderColor: '#3fb950', color: '#3fb950' }
                : { ...styles.button, opacity: 0.55 },
              title: '对左侧勾选的脚本批量执行：启动 / 停止 / 补文档 / 检测重要性 / 隐藏 / 复制路径 / 删除',
              disabled: bulkBusy !== '',
              onClick: () => setBulkMenu((prev) => !prev),
            }, bulkBusy !== '' ? '操作中…' : (picked.size > 0 ? `操作 (${picked.size}) ▾` : '操作 ▾')),
            bulkMenu
              ? h(
                  'div',
                  {
                    style: {
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 4px)',
                      zIndex: 20,
                      minWidth: '188px',
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '4px 0',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: '10px',
                      background: '#12141a',
                      boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
                    },
                  },
                  h('div', { style: { padding: '4px 12px 6px', fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' } },
                    picked.size > 0 ? `已选 ${picked.size} 个脚本` : '先勾选脚本再选择操作'),
                  ...[
                    ['start', '启动选中'],
                    ['stop', '停止选中'],
                    ['ai', 'AI 补全文档'],
                    ['importance', '检测重要性'],
                    ['hide', '隐藏选中'],
                    ['unhide', '取消隐藏'],
                    ['copy', '复制路径'],
                  ].map(([kind, text]) => h('button', {
                    style: { background: 'transparent', border: 'none', textAlign: 'left', padding: '6px 12px', color: 'var(--dsw-alias-label-primary)', fontSize: '12.5px', cursor: picked.size > 0 ? 'pointer' : 'default', opacity: picked.size > 0 ? 1 : 0.5 },
                    disabled: picked.size === 0,
                    onClick: () => void runBulk(kind),
                  }, text)),
                  h('div', { style: { height: '1px', background: 'var(--dsw-alias-border-l1)', margin: '4px 0' } }),
                  h('button', {
                    style: { background: 'transparent', border: 'none', textAlign: 'left', padding: '6px 12px', color: '#e5534b', fontSize: '12.5px', cursor: picked.size > 0 ? 'pointer' : 'default', opacity: picked.size > 0 ? 1 : 0.5 },
                    disabled: picked.size === 0,
                    onClick: () => void runBulk('delete'),
                  }, '删除选中'),
                )
              : null,
          ),
          h('button', {
            style: { ...styles.button, borderColor: '#7aa2f7' },
            title: '按「作用短语 + 版本号」重算显示名（版本按脚本生成来源排序，不改文件名，手动改过名的条目保持不动）',
            disabled: busy === 'autoname',
            onClick: async () => {
              setBusy('autoname')
              setNameMsg('')
              try {
                const payload = await call(API.autoname, { method: 'POST' })
                setNameMsg(payload.changed > 0 ? `已重命名 ${payload.changed} 条` : '显示名已是最新')
                await refresh()
              } catch (error) {
                setNameMsg(`自动命名失败：${error.message || error}`)
              } finally {
                setBusy('')
              }
            },
          }, '自动命名'),
          h('button', {
            style: { ...styles.button, borderColor: '#8b93a7' },
            title: '逐个核对后台进程是否真的还在（插件 pid + 命令行反查 + 计划任务状态），顺便探测 6185/6199/6099 端口',
            disabled: busy === 'status',
            onClick: async () => {
              setBusy('status')
              setStatusMsg('')
              try {
                const payload = await call(API.status)
                const parts = [`${payload.runningCount ?? 0} 个在跑`]
                if ((payload.procCount ?? 0) > 0) parts.push(`其中 ${payload.procCount} 个是命令行匹配到的常驻进程`)
                const scheduled = payload.scheduled ?? []
                if (scheduled.length > 0) parts.push(`${scheduled.length} 个挂计划任务，其中 ${payload.scheduledRunning ?? 0} 个正在跑`)
                if ((payload.exited ?? []).length > 0) parts.push(`${payload.exited.length} 个已退出`)
                if ((payload.reconciled ?? 0) > 0) parts.push(`修正 ${payload.reconciled} 条状态`)
                const probes = payload.probes ?? []
                if (probes.length > 0) {
                  const up = probes.filter((item) => item.listening)
                  parts.push(up.length === probes.length ? `端口 ${probes.map((item) => item.port).join('/')} 全部在听` : `端口 ${probes.filter((item) => !item.listening).map((item) => item.port).join('/')} 没在听`)
                }
                setStatusMsg(`已检查：${parts.join('，')}`)
                setProbeRows(probes)
                await refresh()
              } catch (error) {
                setStatusMsg(`检查失败：${error.message || error}`)
              } finally {
                setBusy('')
              }
            },
          }, busy === 'status' ? '检查中…' : '检查状态'),
          h('button', { style: { ...styles.button, borderColor: '#e6b455' }, onClick: () => void openImport() }, '导入历史脚本'),
          h('button', { style: styles.button, onClick: () => void refresh() }, '刷新'),
        ),
        h('div', { style: { ...styles.sub, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', rowGap: '6px' } },
          h('span', null, `归档目录 ${state.root || '（未配置）'}`),
          h('span', { style: { opacity: 0.7 } }, `· ${visible.length} / ${entries.length} 条`),
          picked.size > 0
            ? h('button', { style: { ...styles.mini, borderColor: '#7aa2f7', color: '#7aa2f7' }, onClick: () => setPicked(new Set()) }, `已选 ${picked.size} · 清空`)
            : null,
        ),
        h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', rowGap: '4px', marginBottom: '6px' } }, filterGroup),
        nameMsg !== '' ? h('div', { style: styles.sub }, nameMsg) : null,
        statusMsg !== '' ? h('div', { style: styles.sub }, statusMsg) : null,
        probeRows.length > 0
          ? h(
              'div',
              { style: { ...styles.sub, display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              probeRows.map((item) =>
                h(
                  'span',
                  {
                    title: item.listening ? `监听 pid ${item.pid}${item.process ? ` (${item.process})` : ''}${item.established ? ` · 已建立 ${item.established} 条连接` : ''}` : '该端口没有监听',
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      border: `1px solid ${item.listening ? 'rgba(63,185,80,0.55)' : 'rgba(229,83,75,0.55)'}`,
                      background: item.listening ? 'rgba(16,32,20,0.55)' : 'rgba(40,18,18,0.55)',
                      color: '#dfe4ef',
                    },
                  },
                  h('span', { style: { fontWeight: 600, color: '#dfe4ef' } }, String(item.port)),
                  h('span', { style: { color: '#aab2c4' } }, item.label),
                  h('span', { style: { color: item.listening ? '#3fb950' : '#e5534b', fontWeight: 600 } },
                    item.listening ? `在听${item.established ? ` · WS ${item.established}` : ''}` : '没在听'),
                ),
              ),
            )
          : null,
        (state.generated ?? []).length > 0
          ? h(
              'div',
              { style: { ...styles.sub, display: 'flex', flexDirection: 'column', gap: '4px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('button', { style: styles.mini, onClick: () => setShowGenerated(!showGenerated) }, showGenerated ? '收起会话' : '展开会话'),
                h('span', null, `插件生成会话 ${(state.generated ?? []).length} 条 · 自动归档产物 ${(state.generated ?? []).reduce((total, item) => total + (item.products?.length ?? 0), 0)} 个脚本`),
              ),
              showGenerated
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflow: 'auto' } },
                    (state.generated ?? []).map((item, index) =>
                      h(
                        'div',
                        { key: `gen-${index}`, style: { display: 'flex', gap: '8px', alignItems: 'baseline' }, title: `${item.sessionId ?? ''}${item.archived ? '\n已在侧边栏归档' : item.archiveError ? `\n归档失败：${item.archiveError}` : ''}${item.transcript ? `\n会话存档：${item.transcript}` : ''}${item.error ? `\n错误：${item.error}` : ''}` },
                        h('span', null, item.kind === 'importance' ? '检测重要性' : '补全文档'),
                        h('span', { style: { opacity: 0.85, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title || `${(item.sessions ?? []).length} 个会话`),
                        h('span', { style: { opacity: 0.7 } }, `目标 ${item.total ?? 0}`),
                        h('span', { style: { opacity: 0.75 } }, (item.products ?? []).length > 0 ? `产物 ${(item.products ?? []).map((product) => product.name).join('、')}` : '无新脚本'),
                        h('span', { style: { opacity: 0.6 }, title: item.archiveError || '' }, item.archived ? '已归档' : '未归档'),
                        h('span', { style: { marginLeft: 'auto', opacity: 0.6 } }, fmtTime(item.at)),
                      ),
                    ),
                  )
                : null,
            )
          : null,
        h(
          'div',
          { style: styles.filterBar },
          h('input', {
            style: { ...styles.input, flex: '1 1 200px', maxWidth: '360px' },
            placeholder: '搜索脚本名 / 项目 / 说明',
            value: queryDraft,
            onChange: (event) => setQueryDraft(event.target.value),
          }),
          h(
            'select',
            { style: { ...styles.input, minWidth: '104px' }, value: category, onChange: (event) => setCategory(event.target.value) },
            h('option', { value: '' }, '全部类别'),
            categories.map((item) => h('option', { key: item, value: item }, `${item}（${state.counts[item]}）`)),
          ),
          h(
            'select',
            { style: { ...styles.input, minWidth: '112px' }, value: sessionFilter, onChange: (event) => setSessionFilter(event.target.value) },
            h('option', { value: '' }, '全部会话'),
            sessions.map((item) => h('option', { key: item, value: item }, `${item}（${state.sessionCounts[item]}）`)),
          ),
          h(
            'select',
            { style: { ...styles.input, minWidth: '92px' }, value: statusFilter, onChange: (event) => setStatusFilter(event.target.value) },
            h('option', { value: '' }, '全部状态'),
            h('option', { value: 'running' }, '运行中'),
            h('option', { value: 'stopped' }, '未运行'),
            h('option', { value: 'scheduled' }, '有计划任务'),
          ),
          h(
            'select',
            { style: { ...styles.input, minWidth: '96px' }, value: importanceFilter, onChange: (event) => setImportanceFilter(event.target.value) },
            h('option', { value: '' }, '全部重要'),
            h('option', { value: 'high' }, '仅看 高'),
            h('option', { value: 'medium' }, '仅看 中'),
            h('option', { value: 'low' }, '仅看 低'),
            h('option', { value: 'pending' }, '待检测'),
          ),
          h(
            'select',
            { style: { ...styles.input, minWidth: '96px' }, value: docFilter, onChange: (event) => setDocFilter(event.target.value) },
            h('option', { value: '' }, '全部文档'),
            h('option', { value: 'need' }, '文档待补全'),
            h('option', { value: 'ok' }, '文档已完整'),
          ),
          h(
            'select',
            { style: { ...styles.input, minWidth: '112px' }, value: sortBy, onChange: (event) => setSortBy(event.target.value), title: '排序方式' },
            h('option', { value: 'default' }, '排序：默认'),
            h('option', { value: 'title' }, '排序：名称'),
            h('option', { value: 'importance' }, '排序：重要度'),
            h('option', { value: 'doc' }, '排序：文档状态'),
            h('option', { value: 'recent' }, '排序：最近启动'),
            h('option', { value: 'created' }, '排序：首次归档'),
          ),

        ),
        startConfirm !== ''
          ? (() => {
              const target = entries.find((item) => item.id === startConfirm)
              return h(
                'div',
                { style: { ...styles.banner, margin: '0 0 8px', borderColor: '#e5534b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
                h('span', { style: { flex: '1 1 100%', lineHeight: '1.6' } }, `「${target ? target.title || target.name : startConfirm}」被标记为高重要性（${target && target.importanceReason ? target.importanceReason : '守护/关键脚本'}）。确定现在启动？`),
                h('button', { style: styles.danger, onClick: () => { const id = startConfirm; setStartConfirm(''); act(id, 'start') } }, '确认启动'),
                h('button', { style: styles.button, onClick: () => setStartConfirm('') }, '取消'),
              )
            })()
          : null,
        h(
          'div',
          { style: styles.formBar },
          h('span', { style: styles.sub }, '手动归档'),
          h('input', { style: { ...styles.input, flex: '1 1 220px', minWidth: '180px' }, placeholder: '脚本绝对路径，如 E:\...\foo.ps1', value: regPath, onChange: (event) => setRegPath(event.target.value) }),
          h('input', { style: { ...styles.input, width: '96px', minWidth: '84px' }, placeholder: '类别（可选）', value: regCategory, onChange: (event) => setRegCategory(event.target.value) }),
          h('input', { style: { ...styles.input, width: '124px', minWidth: '104px' }, placeholder: '会话（可选）', value: regSession, onChange: (event) => setRegSession(event.target.value) }),
          h('input', { style: { ...styles.input, width: '160px', minWidth: '120px' }, placeholder: '一句话说明（可选）', value: regDescription, onChange: (event) => setRegDescription(event.target.value) }),
          h('button', { style: styles.button, disabled: busy === 'register', onClick: register }, '归档'),
        ),
        confirmTarget
          ? h(
              'div',
              { style: { ...styles.banner, display: 'flex', alignItems: 'center', gap: '10px', borderColor: 'var(--dsw-alias-state-error-primary)' } },
              h('span', { style: { flex: '1 1 auto' } }, `确定删除「${confirmTarget.name}」？会删除归档脚本、同名文档与索引记录（日志保留），不可恢复。`),
              h('button', { style: styles.danger, disabled: busy === `${confirmTarget.id}:remove`, onClick: doRemove }, '确认删除'),
              h('button', { style: styles.button, onClick: () => setConfirmTarget(null) }, '取消'),
            )
          : null,
        importOpen
          ? h(
              'div',
              { style: styles.modalMask, onClick: () => (importBusy === '' ? setImportOpen(false) : null) },
              h(
                'div',
                { style: styles.modalCard, onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { style: styles.modalHead },
                  h('strong', {}, '导入历史脚本'),
                  h('span', { style: styles.sub }, `${importVisibleCount} 个候选 / 已选 ${importSel.length}`),
                  h(
                    'span',
                    { style: { display: 'flex', gap: '4px', marginLeft: '6px' } },
                    ['all', 'only', 'hide'].map((mode) =>
                      h(
                        'button',
                        {
                          key: mode,
                          style: { ...styles.mini, ...(importOneOff === mode ? { borderColor: '#e5534b', color: '#ff9b93' } : {}) },
                          onClick: () => setImportOneOff(mode),
                          title: mode === 'only' ? '只看一次性脚本' : mode === 'hide' ? '隐藏一次性脚本' : '显示全部',
                        },
                        mode === 'all' ? '全部' : mode === 'only' ? `只看(${importOneOffCount})` : '隐藏',
                      ),
                    ),
                  ),
                  h(
                    'button',
                    {
                      style: { ...styles.mini, ...(importHideBackup ? { borderColor: '#e6b455', color: '#e6b455' } : {}) },
                      onClick: () => setImportHideBackup(!importHideBackup),
                      title: '备份脚本：文件名含 bak/backup/copy/副本，或位于备份目录',
                    },
                    `备份 ${importHideBackup ? '已隐藏' : '显示中'} (${importBackupCount})`,
                  ),
                  h(
                    'button',
                    {
                      style: { ...styles.mini, ...(importHideStale ? { borderColor: '#8b93a7', color: '#c9cfdb' } : {}) },
                      onClick: () => setImportHideStale(!importHideStale),
                      title: '旧版脚本：名字带 old/legacy/v2 等版本号，或同名脚本的较旧副本',
                    },
                    `旧版 ${importHideStale ? '已隐藏' : '显示中'} (${importStaleCount})`,
                  ),
                  h('div', { style: styles.spacer }),
                  h('button', { style: styles.button, onClick: () => setImportOpen(false) }, '关闭'),
                ),
                h(
                  'div',
                  { style: styles.modalBody },
                  importItems.length === 0
                    ? h('div', { style: styles.empty }, importMsg || '没有可导入的脚本')
                    : importVisibleItems.map((item) =>
                        h(
                          'label',
                          { key: item.key, style: styles.importRow },
                          h('input', { type: 'checkbox', checked: importSel.includes(item.key), onChange: () => toggleImport(item.key) }),
                          h(
                            'span',
                            { style: styles.importName, title: `${item.name}\n${item.path}` },
                            item.displayName || item.name,
                            item.needsName ? h('span', { style: { ...styles.sub, marginLeft: '6px', color: '#e6b455' } }, '待命名') : null,
                            item.oneOff
                              ? h('span', { style: { ...styles.sub, marginLeft: '6px', color: '#e5534b' }, title: item.oneOffReason || '一次性脚本' }, '一次性')
                              : null,
                            item.backup
                              ? h('span', { style: { ...styles.sub, marginLeft: '6px', color: '#e6b455' }, title: item.backupReason || '备份脚本' }, '备份')
                              : null,
                            item.stale
                              ? h('span', { style: { ...styles.sub, marginLeft: '6px', color: '#8b93a7' }, title: item.staleReason || '旧版脚本' }, '旧版')
                              : null,
                          ),
                          h('span', { style: styles.importMeta, title: item.session }, firstSegment(item.session)),
                          h('span', { style: styles.importMeta }, item.mtime.replace('T', ' ').slice(0, 19)),
                          h('span', { style: { ...styles.importTag, color: item.archived ? '#8b93a7' : '#5fd18a' } }, item.archived ? '已归档' : '新'),
                          h('span', { style: { ...styles.importTag, color: item.docPath ? '#8b93a7' : '#e6b455' } }, item.docPath ? '有文档' : '缺文档'),
                          h('span', { style: styles.importPath, title: item.path }, item.path),
                        ),
                      ),
                ),
                importAiConfirm
                  ? h(
                      'div',
                      { style: { ...styles.banner, margin: '0 12px 8px', borderColor: '#e5534b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
                      h('span', { style: { flex: '1 1 100%', lineHeight: '1.6' } }, `将为 ${importSel.length} 个脚本生成文档：由当前 DSH 会话的模型逐条阅读脚本并写入 .md，会消耗该会话 token（通常数千 token/个，可在左下角「今日消费」查看）。继续？`),
                      h('button', { style: styles.danger, disabled: importBusy === 'ai', onClick: () => void runImport(true) }, '确认生成'),
                      h('button', { style: styles.button, onClick: () => setImportAiConfirm(false) }, '取消'),
                    )
                  : null,
                importanceConfirm
                  ? h(
                      'div',
                      { style: { ...styles.banner, margin: '0 12px 8px', borderColor: '#e5534b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
                      h('span', { style: { flex: '1 1 100%', lineHeight: '1.6' } }, `将为 ${importSel.length} 个脚本新建对话检测重要性：AI 会读取它们所属的历史会话再判定高/中/低，会消耗 token（通常数千 token/个，可在左下角「今日消费」查看）。继续？`),
                      h('button', { style: styles.danger, disabled: importBusy === 'importance', onClick: () => void runImportance() }, '确认检测'),
                      h('button', { style: styles.button, onClick: () => setImportanceConfirm(false) }, '取消'),
                    )
                  : null,
                h(
                  'div',
                  { style: { ...styles.sub, padding: '0 14px 10px', lineHeight: '1.6' } },
                  '说明：AI 文档由脚本所属会话的模型读取会话上下文后写入，会消耗该会话 token；不会后台静默生成。勾选后仅排队，需在对应会话里让 AI 补写。',
                ),
                h(
                  'div',
                  { style: { ...styles.modalFoot, flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
                  h('div', { style: { ...styles.sub, minHeight: '18px', lineHeight: '1.5', wordBreak: 'break-all' } }, importMsg),
                  h(
                    'div',
                    { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' } },
                    h('button', { style: styles.mini, onClick: () => setImportSel(importItems.filter((item) => !item.archived).map((item) => item.key)) }, '未归档'),
                    h('button', { style: styles.mini, onClick: () => setImportSel(importItems.map((item) => item.key)) }, '全选'),
                    h('button', { style: styles.mini, onClick: () => setImportSel([]) }, '清空'),
                    h('button', { style: styles.mini, disabled: importBusy !== '' || importSel.length === 0, onClick: () => void runImport(false) }, importBusy === 'plain' ? '导入中…' : `导入(${importSel.length})`),
                    h('button', { style: { ...styles.mini, borderColor: '#7aa2f7', color: '#7aa2f7' }, disabled: importBusy !== '' || importSel.length === 0, onClick: () => void runImportance() }, importBusy === 'importance' ? '排队中…' : '检测重要性'),
                    h('button', { style: { ...styles.mini, borderColor: '#e6b455', color: '#e6b455' }, disabled: importBusy !== '' || importSel.length === 0, onClick: () => void runImport(true) }, importBusy === 'ai' ? '提交中…' : 'AI 生成文档'),
                  ),
                ),
              ),
            )
          : null,
        state.error !== '' ? h('div', { style: styles.error }, state.error) : null,
        aiConfirm
          ? h('div', { style: { ...styles.banner, margin: '0 0 8px', borderColor: '#e5534b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
            h('span', { style: { flex: '1 1 100%', lineHeight: '1.6' } }, `将为 ${state.docNeed || state.pending} 个文档待补全的脚本新建后台会话：插件直接调用当前账号的模型，逐个读取脚本（并参考所属会话历史）重写 .md（含作用/运行方式/参数/依赖/注意事项），会消耗 token（每篇数千 token，可在左下角「今日消费」查看）。继续？`),
            h('button', { style: styles.danger, onClick: () => void runAi() }, busy === 'ai' ? '启动中…' : '确认生成'),
            h('button', { style: styles.button, onClick: () => setAiConfirm(false) }, '取消'),
          )
          : null,
        aiState.active
          ? h('div', { style: { ...styles.banner, margin: '0 0 8px', borderColor: '#7aa2f7', display: 'flex', alignItems: 'center', gap: '10px' } },
            h('span', null, `AI 补全进行中：${aiState.done}/${aiState.total} 已写入${aiState.sessionId ? ` · 会话 ${aiState.sessionId.slice(-8)}` : ''}`),
            h('div', { style: styles.spacer }),
            h('button', { style: styles.mini, onClick: () => void pollAi() }, '刷新进度'),
          )
          : null,
        aiMsg !== '' ? h('div', { style: { ...styles.banner, margin: '0 0 8px' } }, aiMsg) : null,
        impConfirm
          ? h('div', { style: { ...styles.banner, margin: '0 0 8px', borderColor: '#e6b455', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
            h('span', { style: { flex: '1 1 100%', lineHeight: '1.6' } }, '将为 ' + impTargets + ' 个缺等级的脚本新建后台会话：插件调用当前账号模型分批读取脚本与所属会话上下文判定 高/中/低（每批 20 个，会自动续跑），会消耗 token（每个数千 token，可在左下角「今日消费」查看）。继续？'),
            h('button', { style: { ...styles.danger, background: '#e6b455', borderColor: '#e6b455', color: '#1b1e25' }, onClick: () => void runImportanceAll() }, busy === 'importance' ? '启动中…' : '确认检测'),
            h('button', { style: styles.button, onClick: () => setImpConfirm(false) }, '取消'),
          )
          : null,
        impState.active
          ? h('div', { style: { ...styles.banner, margin: '0 0 8px', borderColor: '#7aa2f7', display: 'flex', alignItems: 'center', gap: '10px' } },
            h('span', null, '重要性检测中：' + impState.done + '/' + impState.total + ' 已写回' + (impState.sessionId ? ' · 会话 ' + impState.sessionId.slice(-8) : '')),
            h('div', { style: styles.spacer }),
            h('button', { style: styles.mini, onClick: () => void pollImportance() }, '刷新进度'),
          )
          : null,
        impMsg !== '' ? h('div', { style: { ...styles.banner, margin: '0 0 8px' } }, impMsg) : null,
        notice !== '' ? h('div', { style: styles.banner }, notice) : null,
        bulkConfirmDel
          ? h('div', { style: { ...styles.banner, borderColor: '#e5534b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
            h('span', { style: { flex: '1 1 100%', lineHeight: '1.6' } }, `将删除选中的 ${picked.size} 个脚本：归档文件、同名 .md 与索引记录都会删掉（日志保留），不可恢复。继续？`),
            h('button', { style: styles.danger, disabled: bulkBusy === 'delete', onClick: () => void doBulkRemove() }, bulkBusy === 'delete' ? '删除中…' : '确认删除'),
            h('button', { style: styles.button, onClick: () => setBulkConfirmDel(false) }, '取消'),
          )
          : null,
        bulkMsg !== '' ? h('div', { style: { ...styles.banner, borderColor: '#3fb950' } }, bulkMsg) : null,
        bulkMenu
          ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 18 }, onClick: () => setBulkMenu(false) })
          : null,
        h(
          'div',
          { style: styles.table },
          h(
            'div',
            {
              ref: listRef,
              style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', position: 'relative' },
              onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
            },
            headerRow,
            h('div', { style: { height: `${startIdx * ROW_H}px` } }),
            rows.length > 0
              ? rows
              : h('div', { style: styles.empty }, state.loading ? '加载中…' : '还没有归档任何脚本。写入工作区的 .ps1/.py/.js/.cmd/.bat/.vbs/.sh 会自动归档；也可以在上面填路径手动归档。'),
            h('div', { style: { height: `${Math.max(0, sortedVisible.length - endIdx) * ROW_H}px` } }),
          ),
        ),
        detail,
      )
    }

    function ScriptHubIcon({ size }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'data-dsh-panel-entry': 'script-hub',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M5.2 5.4 2.6 8l2.6 2.6' }),
        h('path', { d: 'M10.8 5.4 13.4 8l-2.6 2.6' }),
        h('path', { d: 'M9.2 3.2 6.8 12.8' }),
      )
    }

    const PANEL_ID = 'script-hub'

    function registerPanel(ctx) {
      const slots = ctx.slots
      const disposers = []
      disposers.push(slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 35, label: () => '脚本中心' }, ScriptHubIcon)))
      disposers.push(slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Panel)))
      return () => {
        for (const dispose of disposers.splice(0)) dispose()
      }
    }

    function apply(ctx) {
      ctx.effect(() => {
        try {
          return registerPanel(ctx)
        } catch (error) {
          console.warn('[script-hub] panel registration failed:', error)
          return () => {}
        }
      }, 'script-hub: ui mounts')
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots']
    return module.exports
  },
})
