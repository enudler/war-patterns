require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
