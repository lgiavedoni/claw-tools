# Claw Tools

A utility dashboard for [OpenClaw](https://github.com/openclaw/openclaw) - view and understand your agent logs in a friendly way.

## Features

- **Log Viewer**: View OpenClaw logs in a clean, human-readable format
  - Groups repetitive messages (like polling/heartbeat) to reduce noise
  - Color-coded by subsystem (WhatsApp, Agent, Memory, etc.)
  - Filter by log level (Error, Warn, Info, Debug)
  - Auto-refresh with live indicator
  - Click to expand and see raw data
- **Configurable**: Change log directory and file path to match your setup
- **Multi-user**: Default settings work for typical OpenClaw installs, but can be customized

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (frontend + backend)
npm run dev
```

Then open:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

## Configuration

### Default Log Path

By default, the app looks for logs in:
```
/tmp/openclaw/openclaw-YYYY-MM-DD.log
```

You can change this in the Settings panel (click the Settings button).

### For Other Users

If your OpenClaw logs are in a different location:
1. Click **Settings** in the top-right
2. Update the **Log Directory** field
3. Select the log file from the dropdown

## Production Build

```bash
# Build the frontend
npm run build

# Run the production server (serves both API and static files)
npm start
```

## API Endpoints

- `GET /api/logs` - Get parsed logs
  - Query params: `dir`, `file`, `limit`, `level`
- `GET /api/logs/files` - List available log files
  - Query params: `dir`
- `GET /api/settings` - Get default settings

## Log Format

The app parses OpenClaw's JSON log format and extracts:
- **Time**: When the event occurred
- **Subsystem**: Which component generated the log (whatsapp, agent, memory, etc.)
- **Level**: DEBUG, INFO, WARN, ERROR
- **Message**: Human-readable description of what happened

Repetitive messages (like memory polling or heartbeats) are grouped together to make the logs easier to read.

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Express.js
- **Styling**: Plain CSS (dark theme)

## License

MIT
