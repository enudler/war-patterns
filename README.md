# War Patterns — Israel Alert Tracker

Real-time tracking and visualisation of Israeli Home Front Command (Pikud Ha'oref) alerts.
Rockets, UAVs, earthquakes and other threat categories are plotted on an interactive map with historical trend charts.

![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20React%20%7C%20PostgreSQL-blue)
![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fenudler%2Fwar--patterns-blue?logo=docker)

---

## How it works

```
oref.org.il (history + live API)
       │  poll every 15 s
       ▼
  Express server  ──►  PostgreSQL (war_patterns DB)
       │
       │  REST API  /api/areas  /api/stats  /api/alerts …
       ▼
  React client (Leaflet map + Recharts)
```

- The server polls two oref endpoints every 15 seconds and deduplicates events by a SHA-1 key derived from alert timestamp + area name.
- Hebrew area names are geocoded to English via a bundled `areas.json` lookup (~160 entries with fuzzy fallback).
- Sub-area duplicates (e.g. multiple Hebrew sub-districts mapping to the same city) are collapsed at query time with `DISTINCT ON (alerted_at, category)`.

---

## Features

| Feature | Detail |
|---|---|
| Interactive map | Circle markers sized by alert count, coloured by threat type |
| Time range | Today / 1d / 2d / 3d / 5d / 7d / 10d / 14d |
| Area detail | Type breakdown (pie), daily trend (bar), hourly pattern (bar) |
| Recent alerts | Scrollable list of the last 20 events |
| Auto-location | Geolocates the browser and selects the nearest area on startup |
| Favourite | Star ☆/★ any area — saved in `localStorage` and restored on next visit |
| Data freshness | Map refreshes every 30 s; UI warns when selected range exceeds available history |

---

## Quick start (Docker Compose)

> **Prerequisites:** Docker + Docker Compose

```bash
# Pull and start (PostgreSQL + app)
docker compose up -d

# Open the app
open http://localhost:3001
```

The first run fetches ~24 h of historical alerts automatically.
Data accumulates as the server continues to poll; the 14-day range fills up over time.

To stop:

```bash
docker compose down           # keep data
docker compose down -v        # also delete the PostgreSQL volume
```

### Build the image locally

```bash
docker compose up --build -d
```

---

## Local development

### Prerequisites

- Node.js 20+
- PostgreSQL (local or Docker)

### 1. Start a local database

```bash
docker run -d --name war-pg \
  -e POSTGRES_DB=war_patterns \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16-alpine
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
# Edit server/.env if your Postgres credentials differ
```

### 3. Run both server and client

```bash
npm install          # installs concurrently at the root
npm start            # server on :3001, client on :5173 (Vite HMR)
```

The Vite dev server talks directly to `http://localhost:3001` via the `VITE_API_URL` default.

---

## Environment variables

All server configuration is via environment variables (or `server/.env` for local dev).

| Variable | Default | Description |
|---|---|---|
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `war_patterns` | Database name |
| `PGUSER` | `postgres` | DB user |
| `PGPASSWORD` | `postgres` | DB password |
| `PORT` | `3001` | HTTP port the server listens on |
| `POLL_INTERVAL_MS` | `15000` | oref API polling interval (ms) |

For the React client, `VITE_API_URL` is baked in at build time:
- **Docker build** — set to `""` (empty) so the client uses relative URLs against the same origin.
- **Local dev** — unset; defaults to `http://localhost:3001`.

---

## API reference

| Method | Path | Query params | Description |
|---|---|---|---|
| GET | `/api/areas` | `days=N` or `today=1` | All areas with alert count + coords |
| GET | `/api/areas/all` | — | All known areas from geocoding table (no DB) |
| GET | `/api/alerts` | `area`, `days`/`today` | Raw alert list for one area (max 100) |
| GET | `/api/stats` | `area`, `days`/`today` | Aggregated stats: byType, byDay, byHour |
| GET | `/api/summary` | `days`/`today` | Global totals by type |
| GET | `/api/status` | — | Oldest/newest alert timestamps in the DB |
| GET | `/health` | — | `{ "status": "ok" }` liveness check |

---

## Docker image

Images are published to the GitHub Container Registry on every push to `main`:

```
ghcr.io/enudler/war-patterns:latest
ghcr.io/enudler/war-patterns:sha-<short-sha>
```

The image is a multi-stage build:
1. **Stage 1** — builds the React client with Vite (`npm run build`).
2. **Stage 2** — runs the Node.js server; the compiled client is copied to `./public` and served as static files at the same origin as the API.

---

## Project structure

```
war-patterns/
├── Dockerfile
├── docker-compose.yml
├── .github/
│   └── workflows/
│       └── docker.yml          # Build & push on push to main
├── server/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── index.js            # Express entry point + static file serving
│       ├── db/
│       │   ├── index.js        # pg Pool singleton
│       │   └── migrate.js      # DDL run on startup
│       ├── poller/
│       │   └── oref.js         # oref API polling + dedup insert
│       ├── routes/
│       │   └── alerts.js       # REST endpoints
│       └── data/
│           └── areas.json      # Hebrew → English geocoding table
└── client/
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── App.jsx
        ├── api/client.js       # axios wrapper
        └── components/
            ├── Map.jsx         # react-leaflet map + click handler
            ├── Sidebar.jsx     # time range selector + stats panel
            └── Charts.jsx      # recharts bar/pie charts
```

---

## Data source

Alerts are fetched from the public Pikud Ha'oref (Israeli Home Front Command) API:

| Endpoint | Content |
|---|---|
| `AlertsHistory.json` | Last ~24 h of alerts (array of flat objects) |
| `alerts.json` | Currently active alert (single object, empty when quiet) |

### Alert categories

| Category | Description |
|---|---|
| 1 | Rocket / Missile |
| 2 | UAV / Drone |
| 3 | Earthquake |
| 4 | Radiological |
| 5 | Chemical |
| 6 | Tsunami |
| 7 | Hostile Aircraft |
| 8 | Unconventional Missile |
| 9 | Infrastructure Hazard |
| 10 | Terrorist Infiltration |

Category 13 (All Clear) and unknown categories are excluded from all counts and charts.
