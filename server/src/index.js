require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const migrate = require('./db/migrate');
const { startPoller } = require('./poller/oref');
const alertRoutes = require('./routes/alerts');

const app = express();
const PORT = process.env.PORT || 3001;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

app.use(cors());
app.use(express.json());

app.use('/api', alertRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

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
