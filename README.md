# War Patterns — Israel Alert Tracker

Tracks missile and alert events from the Israeli Home Front Command (Pikud Ha'oref), stores them in PostgreSQL, and displays trends on an interactive map.

## Quick Start

### 1. PostgreSQL

```bash
# Docker (easiest)
docker run -d --name war-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=war_patterns \
  -p 5432:5432 postgres:16
```

Or use a local Postgres instance. Create a database named `war_patterns`.

### 2. Server

```bash
cd server
cp .env.example .env   # edit if your PG credentials differ
npm install
npm start
```

The server will:
- Auto-create the `alerts` table on first run
- Start polling oref.org.il every 15 seconds
- Serve the API on http://localhost:3001

### 3. Client

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173

## API Endpoints

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | /api/areas | `days` (1–14) | All areas with alert counts + coords |
| GET | /api/alerts | `area`, `days` | Raw alert list for an area |
| GET | /api/stats | `area`, `days` | Aggregated stats (by type / day / hour) |
| GET | /api/summary | `days` | Global summary across all areas |

## Data Source

Pikud Ha'oref (Israeli Home Front Command) public alert API:
- History: `https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json`
- Live: `https://www.oref.org.il/WarningMessages/alert/alerts.json`

## Alert Categories

| Cat | Type |
|-----|------|
| 1 | Rocket / Missile |
| 2 | UAV / Drone |
| 3 | Earthquake |
| 7 | Hostile Aircraft |
| 8 | Unconventional Missile |
| 9 | Infrastructure Hazard |

## Environment Variables (server/.env)

```
PGHOST=localhost
PGPORT=5432
PGDATABASE=war_patterns
PGUSER=postgres
PGPASSWORD=postgres
PORT=3001
POLL_INTERVAL_MS=15000
```
# war-patterns
