# Contributing to Hermes Monitor

Thank you for your interest in contributing!

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/hexu/hermes-monitor.git
cd hermes-monitor
```

### 2. Install Dependencies

```bash
pip install fastapi uvicorn websockets aiohttp
```

### 3. Start the Monitor Server

```bash
cd monitor
python3 backend/monitor_server.py &
# Access at http://localhost:8899/
```

### 4. Run in Development

Changes to `pixel-office.js` and `server-panel.js` take effect on browser refresh (Ctrl+Shift+R).

Changes to `monitor_server.py` require server restart:

```bash
# Kill old process
pkill -f monitor_server.py
# Restart
python3 backend/monitor_server.py &
```

## Code Style

- **JavaScript**: ES6+ features, 2-space indentation
- **Python**: PEP 8, type hints where applicable
- **CSS**: camelCase for class names, hex color codes

## Project Structure

```
monitor/
├── backend/
│   ├── monitor_server.py      # FastAPI backend (HTTP + WebSocket)
│   └── hermes_collector.py    # Hermes metrics collector
├── frontend/
│   ├── index.html             # Entry point
│   ├── pixel-office.js        # Pixel canvas + persona + scene events
│   ├── server-panel.js        # Right-side metrics dashboard
│   └── data/
│       ├── seats.json         # Workstation/bed coordinates
│       ├── tilemap.json       # Tile map data
│       └── rules-v21-m4.json  # Scene event rules & weights
├── claude-proxy-server-80.py  # CC Dev reverse proxy
└── SPEC-*.md                  # Design documents
```

## Key Concepts

### Persona Status Machine

Status is derived from `last_active` timestamp:

| Duration | Status | Location |
|----------|--------|---------|
| < 1 min | working | workstation |
| 1–5 min | thinking | workstation |
| ≥ 5 min (day) | idle | lounge / workstation |
| ≥ 5 min (21:00–08:00) | sleeping | bed |

### Scene Events

Events are defined in `frontend/data/rules-v21-m4.json`. Each event specifies:
- `type`: unique event name
- `participants`: which personas are involved
- `weight`: selection probability (higher = more likely)
- `when`: optional conditions (e.g., `notSleepWindow`)

Adding a new event:
1. Add entry to `sceneEvents.events` array in rules JSON
2. Add layout entry in `sceneEvents.layouts`
3. Add label in `_sceneEventLabel()` map in pixel-office.js
4. Add color logic in `_drawSceneEventOverlay()`

### Metrics Pipeline

```
Hermes Agent
  → POST /api/metrics/ingest
    → monitor_server.py (in-memory state)
      → WebSocket push to browser
      → /api/state and /api/metrics/daily
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run syntax checks:
   ```bash
   node --check monitor/frontend/pixel-office.js
   node --check monitor/frontend/server-panel.js
   python3 -m py_compile monitor/backend/monitor_server.py
   ```
5. Commit with clear message: `git commit -m "feat: add new event type"`
6. Push and open a Pull Request

## Reporting Issues

Please include:
- Browser and OS
- Steps to reproduce
- Expected vs actual behavior
- Screenshot if applicable

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
