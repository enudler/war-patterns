# War Patterns — Claude Code Guide

## Project Overview

Real-time Israeli Home Front Command (Pikud Ha'oref) alert tracker.
Polls the oref.org.il API every 15 s, stores alerts in PostgreSQL, and serves
an interactive React/Leaflet map with trend charts and an attack-probability gauge.

## Architecture

```
oref.org.il API  →  Express server (Node 20)  →  PostgreSQL 16
                          ↓
                  React client (Vite + Leaflet + Recharts)
```

- **server/** — Node.js/Express REST API + background poller
- **client/** — React 19 SPA built with Vite
- **Dockerfile** — multi-stage build (Vite → Node static serve)
- **docker-compose.yml** — PostgreSQL + app with health checks

## Development Commands

```bash
# Install all dependencies (root installs concurrently; workspaces install their own)
npm install
cd server && npm install
cd client && npm install

# Run server + client together (server :3001, client :5173 with HMR)
npm start                    # from repo root

# Server only (with --watch auto-restart)
cd server && npm run dev

# Client only (Vite dev server)
cd client && npm run dev
```

## Testing

```bash
# Server tests (Jest + Supertest) — 68 tests
cd server && npm test

# Client tests (Vitest) — 14 tests
cd client && npm test
```

Tests live at:
- `server/tests/helpers.test.js` — pure helpers: `areaParams`, `timeClause`, `isDST`
- `server/tests/oref.test.js` — poller utilities: `geocode`, `makeOrefId`
- `server/tests/routes.test.js` — all 7 API routes via Supertest with mocked DB pool
- `server/tests/prediction.test.js` — `computePrediction` model: invariants,
  risk-level thresholds, monotonicity, momentum, data-confidence scaling
- `client/src/api/client.test.js` — all API wrapper functions with mocked Axios

## Key Environment Variables

Server (`.env` or Docker env):
```
PGHOST=localhost
PGPORT=5432
PGDATABASE=war_patterns
PGUSER=postgres
PGPASSWORD=postgres
PORT=3001
POLL_INTERVAL_MS=15000
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/api/areas` | Alert counts per area (map markers) |
| GET | `/api/areas/all` | All known areas with coords (no DB) |
| GET | `/api/alerts` | Raw alert list for one area |
| GET | `/api/stats` | Aggregated stats (pie/bar charts) |
| GET | `/api/summary` | Global totals by threat type |
| GET | `/api/prediction` | Next-hour attack probability (0–1) |
| GET | `/api/status` | Oldest/newest alert timestamps |

Query params: `?today=1` (since midnight Israel time) or `?days=N` (1–14).
`/api/alerts`, `/api/stats`, `/api/prediction` require `?area=<area_name_he>`.

## Attack-Probability Model (`computePrediction`)

The pure function lives in `server/src/routes/alerts.js` and is exported via
`module.exports._test` for unit testing. Five factors combined via log-odds:

1. **Base rate** — Laplace-smoothed `(hoursWithAlerts + 1) / (totalHourSlots + 2)`
2. **Hour-of-day** — adaptive-shrinkage ratio of current hour count vs 24-h mean
3. **24-h trend** — recent alert rate vs overall rate, smoothed with κ
4. **Momentum** — `exp(-0.5 * hoursSinceLastAlert)`, peaks at ~1 just after an alert
5. **Day-of-week** — adaptive-shrinkage ratio like hourly factor

All pattern weights are scaled by `dataConfidence = min(1, totalAlerts / 50)` to
prevent sparse datasets from making overconfident predictions.

## Database Schema

Table: `alerts`
- `oref_id VARCHAR(30) UNIQUE` — SHA1(alertDate|areaName), 28 chars, dedup key
- `category SMALLINT` — 1=Rocket/Missile, 2=UAV/Drone (others filtered out)
- `area_name TEXT` — English name (geocoded)
- `area_name_he TEXT` — original Hebrew name
- `lat / lon DOUBLE PRECISION`
- `alerted_at TIMESTAMPTZ`

## Docker

```bash
docker compose up -d            # use pre-built image from ghcr.io
docker compose up --build -d    # build locally
```

Image pushed to `ghcr.io/enudler/war-patterns:latest` on every push to `main`.

## CI/CD

`.github/workflows/docker.yml`:
- **test** job runs on push to `main` and `claude/**` branches, and on PRs to `main`
- **build-and-push** job runs after `test` passes; pushes image only on `main` pushes

## Areas Data

`server/src/data/areas.json` maps Hebrew area names → `{ lat, lon, name_en }`.
~160 entries. Fuzzy geocode fallback strips " - <suffix>" to match parent areas.

## Notable Patterns

- **Deduplication**: SHA1(alertDate|areaName) as `oref_id`; `ON CONFLICT DO NOTHING`
- **Sub-area grouping**: SQL `LIKE 'base - %'` collects siblings under one city
- **Hebrew area matching**: `area_name_he = $1 OR area_name_he LIKE $2` in queries
- **Timezone**: All DB time arithmetic uses `AT TIME ZONE 'Asia/Jerusalem'`
- **Category filter**: Only categories 1 (Rocket/Missile) and 2 (UAV/Drone) shown
