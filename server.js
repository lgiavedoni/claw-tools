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
  if (!trimmed || !trimmed.startsWith('{')) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

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
  try {
    if (entry['0'] && entry['0'].startsWith('{')) {
      const moduleInfo = JSON.parse(entry['0']);
      subsystem = moduleInfo.subsystem || moduleInfo.module || 'system';
    } else if (entry['0']) {
      subsystem = 'openclaw';
    }
  } catch {
    subsystem = 'openclaw';
  }

  // Get the raw message from field "2" or "1"
  let rawMessage = entry['2'] || '';
  if (!rawMessage && typeof entry['1'] === 'string') {
    rawMessage = stripAnsi(entry['1']);
  }
  if (!rawMessage && typeof entry['0'] === 'string' && !entry['0'].startsWith('{')) {
    rawMessage = stripAnsi(entry['0']);
  }

  // Get data from field "1" if it's an object
  const data = typeof entry['1'] === 'object' && entry['1'] !== null ? entry['1'] : {};

  // Determine event type and create friendly message
  let eventType = 'system';
  let friendlyMessage = '';
  let shouldInclude = true;

  // === USER MESSAGE (from web-inbound) ===
  if (subsystem === 'web-inbound' && rawMessage === 'inbound message') {
    eventType = 'user-message';
    friendlyMessage = data.body || 'Message received';
  }
  // === USER MESSAGE (from web-auto-reply with body) ===
  else if (subsystem === 'web-auto-reply' && rawMessage === 'inbound web message') {
    // Skip this one - we already show from web-inbound
    shouldInclude = false;
  }
  // === AGENT RESPONSE (the actual reply text) ===
  else if (rawMessage === 'auto-reply sent (text)' || rawMessage.includes('auto-reply sent')) {
    eventType = 'agent-response';
    friendlyMessage = data.text || 'Agent replied';
  }
  // === AGENT THINKING START ===
  else if (subsystem === 'agent/embedded' && typeof entry['1'] === 'string' && entry['1'].includes('run start')) {
    eventType = 'agent-thinking';
    const msg = entry['1'];
    const modelMatch = msg.match(/model=([^\s]+)/);
    const model = modelMatch ? modelMatch[1].replace('anthropic/', '').replace('openai/', '') : '';
    friendlyMessage = model ? `Thinking with ${model}...` : 'Thinking...';
  }
  // === AGENT DONE ===
  else if (subsystem === 'agent/embedded' && typeof entry['1'] === 'string' && entry['1'].includes('run done')) {
    eventType = 'agent-thinking';
    const msg = entry['1'];
    const durationMatch = msg.match(/durationMs=(\d+)/);
    const duration = durationMatch ? (parseInt(durationMatch[1]) / 1000).toFixed(1) : '';
    const aborted = msg.includes('aborted=true');
    friendlyMessage = aborted ? 'Aborted' : (duration ? `Done (${duration}s)` : 'Done');
  }
  // === TOOL USE START ===
  else if (subsystem === 'agent/embedded' && typeof entry['1'] === 'string' && entry['1'].includes('run tool start')) {
    eventType = 'tool-use';
    const msg = entry['1'];
    const toolMatch = msg.match(/tool=([^\s]+)/);
    const tool = toolMatch ? toolMatch[1] : 'unknown';
    friendlyMessage = `Using ${tool}`;
  }
  // === TOOL USE END ===
  else if (subsystem === 'agent/embedded' && typeof entry['1'] === 'string' && entry['1'].includes('run tool end')) {
    // Skip tool end - we already show tool start
    shouldInclude = false;
  }
  // === Skip other agent/embedded noise ===
  else if (subsystem === 'agent/embedded') {
    shouldInclude = false;
  }
  // === ERRORS (skip Node.js warnings and deprecations) ===
  else if (level === 'ERROR') {
    const msg = rawMessage || entry['0'] || '';
    // Skip Node.js internal warnings
    if (msg.includes('DeprecationWarning') ||
        msg.includes('NODE_TLS_REJECT_UNAUTHORIZED') ||
        msg.startsWith('(node:')) {
      shouldInclude = false;
    } else {
      eventType = 'error';
      friendlyMessage = stripAnsi(msg) || 'Error occurred';
    }
  }
  // === WhatsApp inbound info ===
  else if (subsystem === 'gateway/channels/whatsapp/inbound') {
    // Skip - we show the web-inbound message
    shouldInclude = false;
  }
  // === WhatsApp outbound "Auto-replied" ===
  else if (subsystem === 'gateway/channels/whatsapp/outbound' && typeof entry['1'] === 'string' && entry['1'].includes('Auto-replied')) {
    // Skip - we show the web-auto-reply with actual text
    shouldInclude = false;
  }
  // === WhatsApp outbound "Sent chunk" ===
  else if (subsystem === 'gateway/channels/whatsapp/outbound' && typeof entry['1'] === 'string' && entry['1'].includes('Sent chunk')) {
    // Skip - technical detail
    shouldInclude = false;
  }
  // === Skip other gateway/whatsapp noise ===
  else if (subsystem.includes('gateway/channels/whatsapp')) {
    shouldInclude = false;
  }
  // === Skip memory ===
  else if (subsystem === 'memory') {
    shouldInclude = false;
  }
  // === Skip heartbeat ===
  else if (subsystem === 'web-heartbeat') {
    shouldInclude = false;
  }
  // === Skip diagnostic ===
  else if (subsystem === 'diagnostic') {
    shouldInclude = false;
  }
  // === Skip plugins ===
  else if (subsystem === 'plugins') {
    shouldInclude = false;
  }
  // === Skip gateway/ws ===
  else if (subsystem === 'gateway/ws') {
    shouldInclude = false;
  }
  // === Skip openclaw startup noise ===
  else if (subsystem === 'openclaw' && (!rawMessage || rawMessage.includes('res ✓') || rawMessage.includes('⇄'))) {
    shouldInclude = false;
  }
  // === Other openclaw messages (only errors) ===
  else if (subsystem === 'openclaw') {
    if (level === 'ERROR') {
      eventType = 'error';
      friendlyMessage = stripAnsi(rawMessage || entry['0'] || '');
    } else {
      // Skip system/info messages (startup noise, registered hooks, etc.)
      shouldInclude = false;
    }
  }
  // === DEFAULT: skip unknown noise ===
  else {
    shouldInclude = false;
  }

  if (!shouldInclude || !friendlyMessage) {
    return null;
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
});
