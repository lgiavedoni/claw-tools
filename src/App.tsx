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
}

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [logFile, setLogFile] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

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
        ...(logFile && { file: logFile }),
        limit: '500',
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
  }, [logFile])

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs/files`)
      const data = await res.json()
      setFiles(data.files || [])
    } catch {
      // Ignore
    }
  }, [])

  useEffect(() => {
    fetchLogs()
    fetchFiles()
  }, [fetchLogs, fetchFiles])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchLogs, 3000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchLogs])

  useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

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

  const getEventLabel = (eventType: string) => {
    switch (eventType) {
      case 'user-message': return 'You'
      case 'agent-thinking': return 'Thinking'
      case 'agent-response': return 'Agent'
      case 'tool-use': return 'Tool'
      case 'error': return 'Error'
      default: return 'System'
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
            ⚙️
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="settings-panel">
          <div className="setting">
            <label>Log File</label>
            <select value={logFile} onChange={(e) => setLogFile(e.target.value)}>
              <option value="">Today</option>
              {files.map(f => (
                <option key={f} value={f}>{f.replace('openclaw-', '').replace('.log', '')}</option>
              ))}
            </select>
          </div>
          <div className="setting checkbox">
            <label>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <main className="logs-container" ref={logsContainerRef} onScroll={handleScroll}>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="empty">No activity yet</div>
        ) : (
          <div className="chat-list">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`chat-entry event-${log.eventType} ${expandedLog === i ? 'expanded' : ''}`}
                onClick={() => setExpandedLog(expandedLog === i ? null : i)}
              >
                <div className="chat-icon">{getEventIcon(log.eventType)}</div>
                <div className="chat-content">
                  <div className="chat-header">
                    <span className="chat-label">{getEventLabel(log.eventType)}</span>
                    <span className="chat-time">{log.time}</span>
                  </div>
                  <div className="chat-message">{log.message}</div>
                  {expandedLog === i && Object.keys(log.data).length > 0 && (
                    <pre className="chat-details">{JSON.stringify(log.data, null, 2)}</pre>
                  )}
                </div>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </main>

      {!autoScroll && (
        <button className="jump-btn" onClick={jumpToBottom}>↓ Latest</button>
      )}

      <footer className="footer">
        <span>{logs.length} events</span>
        {autoRefresh && <span className="live-indicator">● Live</span>}
      </footer>
    </div>
  )
}

export default App
