require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const migrate = require('./db/migrate');
const { startPoller } = require('./poller/oref');
const alertRoutes = require('./routes/alerts');

const app = express();
const PORT = process.env.PORT || 3001;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

// Security headers with Helmet.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Allow loading map tiles from OpenStreetMap
}));

// Configure CORS with environment-based origin whitelist
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3001'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  maxAge: 86400, // 24 hours
}));

app.use(express.json({ limit: '1mb' })); // Prevent large payload attacks

// Global request timeout middleware (30 seconds)
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.error('[timeout] Request timeout:', req.method, req.url);
    res.status(408).json({ error: 'Request timeout' });
  });
  res.setTimeout(30000, () => {
    console.error('[timeout] Response timeout:', req.method, req.url);
    res.status(504).json({ error: 'Gateway timeout' });
  });
  next();
});

app.use('/api', alertRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve the OpenAPI spec
app.get('/api/openapi.yaml', (_req, res) => {
  res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));
});

// Serve the built React client when the /public directory exists (Docker).
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

async function main() {
  try {
    await migrate();
  } catch (err) {
    console.error('[startup] DB migration failed:', err.message);
    process.exit(1);
  }

  startPoller(POLL_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
  });
}

main();
