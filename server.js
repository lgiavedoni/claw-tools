import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

const DEFAULT_LOG_DIR = '/tmp/openclaw';

function getTodayLogFile() {
  const today = new Date().toISOString().split('T')[0];
  return `openclaw-${today}.log`;
}

function parseLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const jsonMatch = trimmed.match(/\{.*\}$/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// Strip ANSI codes from strings
function stripAnsi(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

function transformLogEntry(entry) {
  if (!entry) return null;

  const meta = entry._meta || {};
  const time = entry.time || meta.date;
  const level = meta.logLevelName || 'UNKNOWN';

  // Get subsystem
  let subsystem = 'system';
  let moduleInfo = {};
  try {
    if (entry['0']) {
      if (entry['0'].startsWith('{')) {
        moduleInfo = JSON.parse(entry['0']);
        subsystem = moduleInfo.subsystem || moduleInfo.module || 'system';
      } else {
        // It's a plain string message (like error messages)
        subsystem = 'openclaw';
      }
    }
  } catch {
    subsystem = 'openclaw';
  }

  // Get the message from field "2" or "1" (some logs put message in "1" as string)
  let rawMessage = entry['2'] || '';
  if (!rawMessage && typeof entry['1'] === 'string') {
    rawMessage = stripAnsi(entry['1']);
  }
  if (!rawMessage && typeof entry['0'] === 'string' && !entry['0'].startsWith('{')) {
    rawMessage = stripAnsi(entry['0']);
  }

  // Get data from field "1" if it's an object
  const data = typeof entry['1'] === 'object' ? entry['1'] : {};

  // Determine event type and create friendly message
  let eventType = 'system';
  let friendlyMessage = rawMessage;

  // === USER MESSAGE ===
  if (subsystem === 'web-inbound' && rawMessage === 'inbound message') {
    eventType = 'user-message';
    friendlyMessage = data.body || 'Message received';
  }
  // === INBOUND WEB MESSAGE (with formatted body) ===
  else if (subsystem === 'web-auto-reply' && rawMessage === 'inbound web message') {
    eventType = 'user-message';
    // Extract just the message from formatted body like "[WhatsApp +xxx +7m 2026-02-01 11:41 GMT+1] hola"
    const body = data.body || '';
    const match = body.match(/\] (.+)$/);
    friendlyMessage = match ? `You: ${match[1]}` : `You: ${body}`;
  }
  // === AGENT RESPONSE ===
  else if (rawMessage === 'auto-reply sent (text)' || rawMessage.includes('auto-reply sent')) {
    eventType = 'agent-response';
    friendlyMessage = data.text || 'Agent replied';
  }
  // === AGENT THINKING START ===
  else if (subsystem === 'agent/embedded' && rawMessage.includes('run start')) {
    eventType = 'agent-thinking';
    // Extract model info from the message
    const modelMatch = rawMessage.match(/model=([^\s]+)/);
    const model = modelMatch ? modelMatch[1] : 'unknown';
    friendlyMessage = `Thinking... (${model})`;
  }
  // === AGENT PROMPT START ===
  else if (subsystem === 'agent/embedded' && rawMessage.includes('run prompt start')) {
    eventType = 'agent-thinking';
    friendlyMessage = 'Processing prompt...';
  }
  // === AGENT PROMPT END ===
  else if (subsystem === 'agent/embedded' && rawMessage.includes('run prompt end')) {
    eventType = 'agent-thinking';
    const duration = rawMessage.match(/durationMs=(\d+)/);
    friendlyMessage = `Prompt complete (${duration ? duration[1] + 'ms' : ''})`;
  }
  // === AGENT RUN END ===
  else if (subsystem === 'agent/embedded' && rawMessage.includes('run agent end')) {
    eventType = 'agent-thinking';
    friendlyMessage = 'Agent finished thinking';
  }
  // === AGENT DONE ===
  else if (subsystem === 'agent/embedded' && rawMessage.includes('run done')) {
    eventType = 'agent-thinking';
    const duration = rawMessage.match(/durationMs=(\d+)/);
    const aborted = rawMessage.includes('aborted=true');
    friendlyMessage = aborted ? 'Agent aborted' : `Agent complete (${duration ? duration[1] + 'ms' : ''})`;
  }
  // === TOOL USE ===
  else if (subsystem === 'agent/embedded' && rawMessage.includes('run tool')) {
    eventType = 'tool-use';
    const toolMatch = rawMessage.match(/tool=([^\s]+)/);
    const tool = toolMatch ? toolMatch[1] : 'unknown';
    if (rawMessage.includes('start')) {
      friendlyMessage = `Using tool: ${tool}`;
    } else {
      friendlyMessage = `Tool finished: ${tool}`;
    }
  }
  // === WHATSAPP OUTBOUND ===
  else if (subsystem.includes('whatsapp/outbound')) {
    if (rawMessage.includes('Auto-replied')) {
      eventType = 'agent-response';
      friendlyMessage = rawMessage;
    } else if (rawMessage.includes('Sent chunk')) {
      eventType = 'agent-response';
      const match = rawMessage.match(/to ([\+\d]+)/);
      friendlyMessage = match ? `Sent to ${match[1]}` : rawMessage;
    } else {
      eventType = 'system';
    }
  }
  // === WHATSAPP INBOUND ===
  else if (subsystem.includes('whatsapp/inbound')) {
    eventType = 'user-message';
    friendlyMessage = rawMessage;
  }
  // === ERRORS ===
  else if (level === 'ERROR') {
    eventType = 'error';
    friendlyMessage = rawMessage || entry['0'] || 'Error occurred';
  }
  // === MEMORY (usually hidden) ===
  else if (subsystem === 'memory') {
    eventType = 'system';
    friendlyMessage = 'Processing memory...';
  }
  // === HEARTBEAT (usually hidden) ===
  else if (subsystem === 'web-heartbeat') {
    eventType = 'system';
    friendlyMessage = `Heartbeat (${data.messagesHandled || 0} messages)`;
  }
  // === DEFAULT ===
  else {
    eventType = 'system';
    friendlyMessage = rawMessage || stripAnsi(entry['1']) || 'System event';
  }

  return {
    time: time ? new Date(time).toLocaleTimeString() : '',
    timestamp: time,
    level,
    subsystem,
    eventType,
    message: friendlyMessage,
    rawMessage: rawMessage || '',
    data,
    raw: entry
  };
}

app.get('/api/logs', (req, res) => {
  const logDir = req.query.dir || DEFAULT_LOG_DIR;
  const logFile = req.query.file || getTodayLogFile();
  const logPath = path.join(logDir, logFile);
  const limit = parseInt(req.query.limit) || 1000;

  try {
    if (!fs.existsSync(logPath)) {
      return res.json({
        logs: [],
        error: `Log file not found: ${logPath}`,
        path: logPath
      });
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    const logs = [];
    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (parsed) {
        const transformed = transformLogEntry(parsed);
        if (transformed) {
          logs.push(transformed);
        }
      }
    }

    const result = logs.slice(-limit);

    res.json({
      logs: result,
      total: logs.length,
      path: logPath,
      showing: result.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message, path: logPath });
  }
});

app.get('/api/logs/files', (req, res) => {
  const logDir = req.query.dir || DEFAULT_LOG_DIR;

  try {
    if (!fs.existsSync(logDir)) {
      return res.json({ files: [], error: `Directory not found: ${logDir}` });
    }

    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();

    res.json({ files, dir: logDir });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings', (req, res) => {
  res.json({
    defaultLogDir: DEFAULT_LOG_DIR,
    defaultLogFile: getTodayLogFile()
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Claw Tools server running on http://localhost:${PORT}`);
  console.log(`Default log directory: ${DEFAULT_LOG_DIR}`);
});
