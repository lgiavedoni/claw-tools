import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
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
  raw?: Record<string, unknown>
}

interface ChatGroup {
  id: number
  userMessage?: LogEntry
  agentResponse?: LogEntry
  intermediateEvents: LogEntry[]
  isThinking: boolean
}

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set())
  const [logFile, setLogFile] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  const logsContainerRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const lastScrollTop = useRef(0)

  const API_BASE = 'http://localhost:3001'

  const scrollToBottom = useCallback(() => {
    if (!isUserScrolling && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [isUserScrolling])

  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100

    // Detect if user is scrolling up
    if (scrollTop < lastScrollTop.current - 10) {
      setIsUserScrolling(true)
    }

    // If at bottom, allow auto-scroll again
    if (isAtBottom) {
      setIsUserScrolling(false)
    }

    lastScrollTop.current = scrollTop
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
    setIsUserScrolling(false)
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Group logs into chat conversations
  const groupLogs = useCallback((): ChatGroup[] => {
    const groups: ChatGroup[] = []
    let currentGroup: ChatGroup | null = null
    let groupId = 0

    for (const log of logs) {
      if (log.eventType === 'user-message') {
        // Start a new group
        if (currentGroup) {
          groups.push(currentGroup)
        }
        currentGroup = {
          id: groupId++,
          userMessage: log,
          intermediateEvents: [],
          isThinking: false
        }
      } else if (log.eventType === 'agent-response') {
        if (currentGroup) {
          currentGroup.agentResponse = log
          currentGroup.isThinking = false
          groups.push(currentGroup)
          currentGroup = null
        } else {
          // Agent response without user message
          groups.push({
            id: groupId++,
            agentResponse: log,
            intermediateEvents: [],
            isThinking: false
          })
        }
      } else if (log.eventType === 'agent-thinking') {
        if (currentGroup) {
          // Check if it's a "thinking start" or "done"
          if (log.message.toLowerCase().includes('thinking')) {
            currentGroup.isThinking = true
          } else if (log.message.toLowerCase().includes('done')) {
            currentGroup.isThinking = false
          }
          currentGroup.intermediateEvents.push(log)
        }
      } else {
        // tool-use, error, system
        if (currentGroup) {
          currentGroup.intermediateEvents.push(log)
        } else {
          // Standalone event
          groups.push({
            id: groupId++,
            intermediateEvents: [log],
            isThinking: false
          })
        }
      }
    }

    // Push any remaining group (still thinking)
    if (currentGroup) {
      groups.push(currentGroup)
    }

    return groups
  }, [logs])

  const toggleGroupExpand = (groupId: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const toggleDetails = (key: string) => {
    setExpandedDetails(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const chatGroups = groupLogs()

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
        ) : chatGroups.length === 0 ? (
          <div className="empty">No activity yet</div>
        ) : (
          <div className="chat-list">
            {chatGroups.map((group) => (
              <div key={group.id} className="chat-group">
                {/* User Message - Right aligned */}
                {group.userMessage && (
                  <div className="chat-row user-row">
                    <div className="chat-bubble user-bubble">
                      <div className="bubble-time">{group.userMessage.time}</div>
                      <div className="bubble-content">
                        <ReactMarkdown>{group.userMessage.message}</ReactMarkdown>
                      </div>
                      <button
                        className="expand-btn"
                        onClick={() => toggleDetails(`user-${group.id}`)}
                        title="Show details"
                      >
                        {expandedDetails.has(`user-${group.id}`) ? '−' : '+'}
                      </button>
                      {expandedDetails.has(`user-${group.id}`) && (
                        <pre className="bubble-details">
                          {JSON.stringify(group.userMessage.raw || group.userMessage.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )}

                {/* Intermediate Events (collapsed by default) */}
                {group.intermediateEvents.length > 0 && (
                  <div className="intermediate-section">
                    <button
                      className="intermediate-toggle"
                      onClick={() => toggleGroupExpand(group.id)}
                    >
                      {expandedGroups.has(group.id) ? '▼' : '▶'}
                      {group.intermediateEvents.length} event{group.intermediateEvents.length !== 1 ? 's' : ''}
                      ({group.intermediateEvents.filter(e => e.eventType === 'tool-use').length} tools,
                      {group.intermediateEvents.filter(e => e.eventType === 'error').length} errors)
                    </button>

                    {expandedGroups.has(group.id) && (
                      <div className="intermediate-events">
                        {group.intermediateEvents.map((event, i) => (
                          <div
                            key={i}
                            className={`intermediate-event event-${event.eventType}`}
                            onClick={() => toggleDetails(`event-${group.id}-${i}`)}
                          >
                            <span className="event-icon">
                              {event.eventType === 'tool-use' ? '🔧' :
                               event.eventType === 'error' ? '❌' :
                               event.eventType === 'agent-thinking' ? '💭' : '📋'}
                            </span>
                            <span className="event-time">{event.time}</span>
                            <span className="event-message">{event.message}</span>
                            {expandedDetails.has(`event-${group.id}-${i}`) && (
                              <pre className="event-details">
                                {JSON.stringify(event.raw || event.data, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Loading indicator when thinking */}
                {group.isThinking && !group.agentResponse && (
                  <div className="chat-row agent-row">
                    <div className="chat-bubble agent-bubble thinking-bubble">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Agent Response - Left aligned */}
                {group.agentResponse && (
                  <div className="chat-row agent-row">
                    <div className="chat-bubble agent-bubble">
                      <div className="bubble-time">{group.agentResponse.time}</div>
                      <div className="bubble-content">
                        <ReactMarkdown>{group.agentResponse.message}</ReactMarkdown>
                      </div>
                      <button
                        className="expand-btn"
                        onClick={() => toggleDetails(`agent-${group.id}`)}
                        title="Show details"
                      >
                        {expandedDetails.has(`agent-${group.id}`) ? '−' : '+'}
                      </button>
                      {expandedDetails.has(`agent-${group.id}`) && (
                        <pre className="bubble-details">
                          {JSON.stringify(group.agentResponse.raw || group.agentResponse.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )}

                {/* Standalone events (errors without context) */}
                {!group.userMessage && !group.agentResponse && group.intermediateEvents.length > 0 && (
                  <div className="standalone-events">
                    {group.intermediateEvents.map((event, i) => (
                      <div
                        key={i}
                        className={`standalone-event event-${event.eventType}`}
                        onClick={() => toggleDetails(`standalone-${group.id}-${i}`)}
                      >
                        <span className="event-icon">
                          {event.eventType === 'tool-use' ? '🔧' :
                           event.eventType === 'error' ? '❌' : '📋'}
                        </span>
                        <span className="event-time">{event.time}</span>
                        <span className="event-message">{event.message}</span>
                        {expandedDetails.has(`standalone-${group.id}-${i}`) && (
                          <pre className="event-details">
                            {JSON.stringify(event.raw || event.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </main>

      {isUserScrolling && (
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
