import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

interface LogEntry {
  time: string
  timestamp: string
  level: string
  subsystem: string
  eventType: string
  message: string
  rawMessage: string
  data: Record<string, unknown>
  raw: Record<string, unknown>
}

interface Settings {
  logDir: string
  logFile: string
  autoRefresh: boolean
  refreshInterval: number
  showLevel: string
  limit: number
}

const EVENT_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  agent: '#646cff',
  memory: '#f59e0b',
  heartbeat: '#6b7280',
  diagnostic: '#8b5cf6',
  info: '#3b82f6',
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: '#ef4444',
  WARN: '#f59e0b',
  INFO: '#3b82f6',
  DEBUG: '#6b7280',
}

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
    refreshInterval: 5000,
    showLevel: 'all',
    limit: 500,
  })
  const [showSettings, setShowSettings] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const logsContainerRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const API_BASE = 'http://localhost:3001'

  const scrollToBottom = useCallback(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [autoScroll])

  // Check if user has scrolled up (disable auto-scroll)
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
        level: settings.showLevel,
      })
      const res = await fetch(`${API_BASE}/api/logs?${params}`)
      const data = await res.json()

      if (data.error && data.logs?.length === 0) {
        setError(data.error)
      } else {
        setError(null)
      }
      setLogs(data.logs || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [settings.logDir, settings.logFile, settings.limit, settings.showLevel])

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs/files?dir=${settings.logDir}`)
      const data = await res.json()
      setFiles(data.files || [])
    } catch {
      // Ignore file list errors
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

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

  // Group consecutive similar messages
  const groupedLogs = logs.reduce<(LogEntry & { count: number })[]>((acc, log) => {
    const prev = acc[acc.length - 1]
    if (prev && prev.message === log.message && prev.subsystem === log.subsystem) {
      prev.count++
      prev.time = log.time // Update to latest time
    } else {
      acc.push({ ...log, count: 1 })
    }
    return acc
  }, [])

  const jumpToBottom = () => {
    setAutoScroll(true)
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Claw Tools</h1>
        <div className="header-actions">
          <button onClick={fetchLogs} className="refresh-btn">
            Refresh
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`settings-btn ${showSettings ? 'active' : ''}`}
          >
            Settings
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="settings-panel">
          <div className="setting">
            <label>Log Directory</label>
            <input
              type="text"
              value={settings.logDir}
              onChange={(e) => setSettings({ ...settings, logDir: e.target.value })}
              placeholder="/tmp/openclaw"
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
            <label>Log Level</label>
            <select
              value={settings.showLevel}
              onChange={(e) => setSettings({ ...settings, showLevel: e.target.value })}
            >
              <option value="all">All</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
          <div className="setting">
            <label>Max Entries</label>
            <input
              type="number"
              value={settings.limit}
              onChange={(e) => setSettings({ ...settings, limit: parseInt(e.target.value) || 500 })}
              min={50}
              max={5000}
            />
          </div>
          <div className="setting checkbox">
            <label>
              <input
                type="checkbox"
                checked={settings.autoRefresh}
                onChange={(e) => setSettings({ ...settings, autoRefresh: e.target.checked })}
              />
              Auto-refresh every {settings.refreshInterval / 1000}s
            </label>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <main
        className="logs-container"
        ref={logsContainerRef}
        onScroll={handleScroll}
      >
        {loading ? (
          <div className="loading">Loading logs...</div>
        ) : groupedLogs.length === 0 ? (
          <div className="empty">No logs found</div>
        ) : (
          <div className="logs-list">
            {groupedLogs.map((log, i) => (
              <div
                key={i}
                className={`log-entry ${log.level.toLowerCase()} ${expandedLog === i ? 'expanded' : ''}`}
                onClick={() => setExpandedLog(expandedLog === i ? null : i)}
              >
                <div className="log-main">
                  <span className="log-time">{log.time}</span>
                  <span
                    className="log-type"
                    style={{ backgroundColor: EVENT_COLORS[log.eventType] || EVENT_COLORS.info }}
                  >
                    {log.subsystem}
                  </span>
                  <span
                    className="log-level"
                    style={{ color: LEVEL_COLORS[log.level] || '#6b7280' }}
                  >
                    {log.level}
                  </span>
                  <span className="log-message">{log.message}</span>
                  {log.count > 1 && (
                    <span className="log-count">x{log.count}</span>
                  )}
                </div>
                {expandedLog === i && (
                  <div className="log-details">
                    <div className="detail-section">
                      <strong>Raw Message:</strong>
                      <code>{log.rawMessage}</code>
                    </div>
                    {Object.keys(log.data).length > 0 && (
                      <div className="detail-section">
                        <strong>Data:</strong>
                        <pre>{JSON.stringify(log.data, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </main>

      {!autoScroll && (
        <button className="jump-to-bottom" onClick={jumpToBottom}>
          Jump to latest
        </button>
      )}

      <footer className="footer">
        <span>{logs.length} entries ({groupedLogs.length} grouped)</span>
        {settings.autoRefresh && <span className="pulse">Live</span>}
      </footer>
    </div>
  )
}

export default App
