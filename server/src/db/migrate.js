const pool = require('./index');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id          BIGSERIAL PRIMARY KEY,
        oref_id     VARCHAR(30) UNIQUE NOT NULL,
        category    SMALLINT NOT NULL,
        category_desc TEXT,
        area_name   TEXT NOT NULL,
        area_name_he TEXT,
        lat         DOUBLE PRECISION,
        lon         DOUBLE PRECISION,
        alerted_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_area_alerted
        ON alerts(area_name, alerted_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_alerted_at
        ON alerts(alerted_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_category
        ON alerts(category);
    `);

    // Index for Hebrew area name queries (used in all area-specific endpoints)
    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_area_name_he
        ON alerts(area_name_he);
    `);

    // Composite index for common query pattern: area + time + category filter
    // Supports queries with LIKE 'base - %' pattern and category IN (1, 2)
    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_area_he_alerted_category
        ON alerts(area_name_he, alerted_at DESC, category)
        WHERE category IN (1, 2);
    `);

    console.log('[migrate] Schema ready.');
  } finally {
    client.release();
  }
}

module.exports = migrate;
