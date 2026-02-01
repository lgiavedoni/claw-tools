import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

interface LogEntry {
  time: string
  timestamp: string
  level: string
  subsystem: string
  eventType: 'user-message' | 'agent-thinking' | 'agent-response' | 'tool-use' | 'error' | 'system'
  message: string
  rawMessage: string
  data: Record<string, unknown>
  raw: Record<string, unknown>
  hidden?: boolean
}

interface Settings {
  logDir: string
  logFile: string
  autoRefresh: boolean
  refreshInterval: number
  limit: number
}

const HIDDEN_TAGS_DEFAULT = ['memory', 'web-heartbeat', 'diagnostic', 'plugins', 'gateway/ws']

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [settings, setSettings] = useState<Settings>({
    logDir: '/tmp/openclaw',
    logFile: '',
    autoRefresh: true,
    refreshInterval: 3000,
    limit: 1000,
  })
  const [showSettings, setShowSettings] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [hiddenTags, setHiddenTags] = useState<Set<string>>(new Set(HIDDEN_TAGS_DEFAULT))
  const [allTags, setAllTags] = useState<string[]>([])

  const logsContainerRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const API_BASE = 'http://localhost:3001'

  const scrollToBottom = useCallback(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [autoScroll])

  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100
    setAutoScroll(isAtBottom)
  }, [])

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        dir: settings.logDir,
        ...(settings.logFile && { file: settings.logFile }),
        limit: settings.limit.toString(),
      })
      const res = await fetch(`${API_BASE}/api/logs?${params}`)
      const data = await res.json()

      if (data.error && data.logs?.length === 0) {
        setError(data.error)
      } else {
        setError(null)
      }

      const processedLogs = data.logs || []
      setLogs(processedLogs)

      // Collect all unique tags
      const tags = new Set<string>()
      processedLogs.forEach((log: LogEntry) => {
        if (log.subsystem) tags.add(log.subsystem)
      })
      setAllTags(Array.from(tags).sort())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [settings.logDir, settings.logFile, settings.limit])

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs/files?dir=${settings.logDir}`)
      const data = await res.json()
      setFiles(data.files || [])
    } catch {
      // Ignore
    }
  }, [settings.logDir])

  useEffect(() => {
    fetchLogs()
    fetchFiles()
  }, [fetchLogs, fetchFiles])

  useEffect(() => {
    if (!settings.autoRefresh) return
    const interval = setInterval(fetchLogs, settings.refreshInterval)
    return () => clearInterval(interval)
  }, [settings.autoRefresh, settings.refreshInterval, fetchLogs])

  useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

  const toggleTag = (tag: string) => {
    setHiddenTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) {
        next.delete(tag)
      } else {
        next.add(tag)
      }
      return next
    })
  }

  // Filter and group logs
  const visibleLogs = logs.filter(log => !hiddenTags.has(log.subsystem))

  const groupedLogs = visibleLogs.reduce<(LogEntry & { count: number })[]>((acc, log) => {
    const prev = acc[acc.length - 1]
    if (prev && prev.message === log.message && prev.subsystem === log.subsystem && prev.eventType === log.eventType) {
      prev.count++
      prev.time = log.time
    } else {
      acc.push({ ...log, count: 1 })
    }
    return acc
  }, [])

  const jumpToBottom = () => {
    setAutoScroll(true)
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'user-message': return '💬'
      case 'agent-thinking': return '🤔'
      case 'agent-response': return '🤖'
      case 'tool-use': return '🔧'
      case 'error': return '❌'
      default: return '📋'
    }
  }

  const getEventClass = (eventType: string) => {
    switch (eventType) {
      case 'user-message': return 'event-user'
      case 'agent-thinking': return 'event-thinking'
      case 'agent-response': return 'event-response'
      case 'tool-use': return 'event-tool'
      case 'error': return 'event-error'
      default: return 'event-system'
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Claw Tools</h1>
        <div className="header-actions">
          <button onClick={fetchLogs} className="btn btn-primary">
            Refresh
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`btn btn-secondary ${showSettings ? 'active' : ''}`}
          >
            Settings
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="settings-panel">
          <div className="settings-row">
            <div className="setting">
              <label>Log Directory</label>
              <input
                type="text"
                value={settings.logDir}
                onChange={(e) => setSettings({ ...settings, logDir: e.target.value })}
              />
            </div>
            <div className="setting">
              <label>Log File</label>
              <select
                value={settings.logFile}
                onChange={(e) => setSettings({ ...settings, logFile: e.target.value })}
              >
                <option value="">Today's log</option>
                {files.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="setting">
              <label>Max Entries</label>
              <input
                type="number"
                value={settings.limit}
                onChange={(e) => setSettings({ ...settings, limit: parseInt(e.target.value) || 1000 })}
                min={100}
                max={10000}
              />
            </div>
            <div className="setting checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={settings.autoRefresh}
                  onChange={(e) => setSettings({ ...settings, autoRefresh: e.target.checked })}
                />
                Auto-refresh
              </label>
            </div>
          </div>

          <div className="tags-filter">
            <span className="tags-label">Filter tags:</span>
            <div className="tags-list">
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={`tag-btn ${hiddenTags.has(tag) ? 'hidden' : 'visible'}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">{error}</div>
      )}

      <main className="logs-container" ref={logsContainerRef} onScroll={handleScroll}>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : groupedLogs.length === 0 ? (
          <div className="empty">No logs found</div>
        ) : (
          <div className="chat-list">
            {groupedLogs.map((log, i) => (
              <div
                key={i}
                className={`chat-entry ${getEventClass(log.eventType)} ${expandedLog === i ? 'expanded' : ''}`}
                onClick={() => setExpandedLog(expandedLog === i ? null : i)}
              >
                <div className="chat-icon">{getEventIcon(log.eventType)}</div>
                <div className="chat-content">
                  <div className="chat-header">
                    <span className="chat-time">{log.time}</span>
                    <span className={`chat-tag tag-${log.eventType}`}>{log.subsystem}</span>
                    {log.count > 1 && <span className="chat-count">×{log.count}</span>}
                  </div>
                  <div className="chat-message">{log.message}</div>
                  {expandedLog === i && (
                    <div className="chat-details">
                      {log.rawMessage !== log.message && (
                        <div className="detail-row">
                          <span className="detail-label">Raw:</span>
                          <span className="detail-value">{log.rawMessage}</span>
                        </div>
                      )}
                      {Object.keys(log.data).length > 0 && (
                        <pre className="detail-json">{JSON.stringify(log.data, null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </main>

      {!autoScroll && (
        <button className="jump-btn" onClick={jumpToBottom}>
          ↓ Jump to latest
        </button>
      )}

      <footer className="footer">
        <span>{visibleLogs.length} of {logs.length} entries</span>
        {settings.autoRefresh && <span className="live-indicator">● Live</span>}
      </footer>
    </div>
  )
}

export default App
