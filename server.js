import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Default log path
const DEFAULT_LOG_DIR = '/tmp/openclaw';

// Get today's date for default log file
function getTodayLogFile() {
  const today = new Date().toISOString().split('T')[0];
  return `openclaw-${today}.log`;
}

// Parse a single log line
function parseLogLine(line) {
  // Log format: "HH:MM:SS AM/PM\nlevel\nsubsystem\n{json}"
  // But in the file it's typically one JSON per line with prefix
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try to find JSON in the line
  const jsonMatch = trimmed.match(/\{.*\}$/);
  if (!jsonMatch) {
    // Might be a time, level, or subsystem line - skip
    return null;
  }

  try {
    const json = JSON.parse(jsonMatch[0]);
    return json;
  } catch {
    return null;
  }
}

// Transform raw log entry to friendly format
function transformLogEntry(entry) {
  if (!entry) return null;

  const meta = entry._meta || {};
  const time = entry.time || meta.date;
  const level = meta.logLevelName || 'UNKNOWN';

  // Get subsystem from the "0" field or meta.name
  let subsystem = 'system';
  try {
    if (entry['0']) {
      const parsed = JSON.parse(entry['0']);
      subsystem = parsed.subsystem || parsed.module || 'system';
    }
  } catch {
    subsystem = meta.name || 'system';
  }

  // Get the human-readable message from field "2"
  const message = entry['2'] || '';

  // Get additional data from field "1"
  const data = entry['1'] || {};

  // Determine event type for friendly display
  let eventType = 'info';
  let friendlyMessage = message;

  // Categorize and make messages more friendly
  if (subsystem.includes('whatsapp')) {
    eventType = 'whatsapp';
    if (message.includes('Sent chunk')) {
      const match = message.match(/Sent chunk \d+\/\d+ to ([\+\d]+)/);
      friendlyMessage = match ? `Message sent to ${match[1]}` : message;
    } else if (message.includes('auto-reply sent')) {
      friendlyMessage = `Auto-reply sent: ${data.text?.substring(0, 100) || message}`;
    }
  } else if (subsystem === 'memory') {
    eventType = 'memory';
    if (message.includes('gemini batch')) {
      friendlyMessage = 'Processing memory embeddings...';
    }
  } else if (subsystem.includes('agent')) {
    eventType = 'agent';
    if (message.includes('run agent end')) {
      friendlyMessage = 'Agent completed task';
    } else if (message.includes('run prompt end')) {
      friendlyMessage = `Agent response ready (${data.durationMs}ms)`;
    }
  } else if (subsystem === 'web-heartbeat') {
    eventType = 'heartbeat';
    friendlyMessage = `Gateway alive - ${data.messagesHandled || 0} messages handled`;
  } else if (subsystem.includes('diagnostic')) {
    eventType = 'diagnostic';
    if (message.includes('session state')) {
      friendlyMessage = `Session: ${data.prev} -> ${data.new}`;
    }
  }

  return {
    time: time ? new Date(time).toLocaleTimeString() : '',
    timestamp: time,
    level,
    subsystem,
    eventType,
    message: friendlyMessage,
    rawMessage: message,
    data,
    raw: entry
  };
}

// API: Get logs
app.get('/api/logs', (req, res) => {
  const logDir = req.query.dir || DEFAULT_LOG_DIR;
  const logFile = req.query.file || getTodayLogFile();
  const logPath = path.join(logDir, logFile);
  const limit = parseInt(req.query.limit) || 500;
  const level = req.query.level || 'all';

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

    // Parse and transform logs
    const logs = [];
    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (parsed) {
        const transformed = transformLogEntry(parsed);
        if (transformed) {
          // Filter by level if specified
          if (level === 'all' || transformed.level.toLowerCase() === level.toLowerCase()) {
            logs.push(transformed);
          }
        }
      }
    }

    // Return latest logs (tail)
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

// API: List available log files
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

// API: Get settings
app.get('/api/settings', (req, res) => {
  res.json({
    defaultLogDir: DEFAULT_LOG_DIR,
    defaultLogFile: getTodayLogFile()
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  // Express 5 requires named wildcard parameter
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Claw Tools server running on http://localhost:${PORT}`);
  console.log(`Default log directory: ${DEFAULT_LOG_DIR}`);
});
