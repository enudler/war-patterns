const express = require('express');
const pool = require('../db/index');
const areasData = require('../data/areas.json');

const router = express.Router();

// Exclude non-threat categories from all queries
const EXCLUDE_FILTER = `category != 13 AND category_desc NOT LIKE 'Unknown%'`;

// GET /api/areas/all — all known areas with coords (no DB needed)
router.get('/areas/all', (_req, res) => {
  const result = Object.entries(areasData).map(([name_he, v]) => ({
    area_name: v.name_en,
    area_name_he: name_he,
    lat: v.lat,
    lon: v.lon,
  }));
  res.json(result);
});

// Returns { clause, params, label } for WHERE time filter.
// today=1  → since midnight Israel time (Asia/Jerusalem, DST-aware via PG)
// days=N   → last N days (1–14)
// paramBase is the $N index for the days param (ignored for today)
function timeClause(query, paramBase = 1) {
  if (query.today === '1') {
    return {
      clause: `alerted_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`,
      params: [],
      label: 'today',
    };
  }
  const d = parseInt(query.days || '7', 10);
  const days = isNaN(d) || d < 1 ? 1 : d > 14 ? 14 : d;
  return {
    clause: `alerted_at >= NOW() - ($${paramBase} || ' days')::interval`,
    params: [days],
    label: `${days}d`,
  };
}

// GET /api/areas?days=N  or  ?today=1
// Groups by area_name_he so every oref sub-area gets its own marker on the map.
router.get('/areas', async (req, res) => {
  const tc = timeClause(req.query, 1);
  try {
    const result = await pool.query(
      `SELECT
         area_name_he,
         area_name,
         lat,
         lon,
         COUNT(*)                                         AS alert_count,
         MAX(alerted_at)                                  AS last_alert,
         MODE() WITHIN GROUP (ORDER BY category)          AS dominant_category,
         MODE() WITHIN GROUP (ORDER BY category_desc)     AS dominant_category_desc
       FROM alerts
       WHERE ${tc.clause}
         AND lat IS NOT NULL
         AND ${EXCLUDE_FILTER}
       GROUP BY area_name_he, area_name, lat, lon
       ORDER BY alert_count DESC`,
      tc.params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[/areas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts?area=<area_name_he>&days=N  or  ?area=<area_name_he>&today=1
// area param is the Hebrew sub-area name (area_name_he).
router.get('/alerts', async (req, res) => {
  const area = req.query.area;
  if (!area) return res.status(400).json({ error: 'area param required' });
  const tc = timeClause(req.query, 2);
  try {
    const result = await pool.query(
      `SELECT id, oref_id, category, category_desc, area_name, area_name_he, lat, lon, alerted_at
       FROM alerts
       WHERE area_name_he = $1
         AND ${tc.clause}
         AND ${EXCLUDE_FILTER}
       ORDER BY alerted_at DESC
       LIMIT 100`,
      [area, ...tc.params]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[/alerts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats?area=<area_name_he>&days=N  or  ?area=<area_name_he>&today=1
// area param is the Hebrew sub-area name (area_name_he).
router.get('/stats', async (req, res) => {
  const area = req.query.area;
  if (!area) return res.status(400).json({ error: 'area param required' });
  const tc = timeClause(req.query, 2);
  const qParams = [area, ...tc.params];

  const dedupCte = `
    WITH deduped AS (
      SELECT alerted_at, category, category_desc
      FROM alerts
      WHERE area_name_he = $1
        AND ${tc.clause}
        AND ${EXCLUDE_FILTER}
    )
  `;

  try {
    const [byType, byDay, byHour, totalResult] = await Promise.all([
      pool.query(
        `${dedupCte}
         SELECT category, category_desc, COUNT(*) AS count
         FROM deduped
         GROUP BY category, category_desc
         ORDER BY count DESC`,
        qParams
      ),
      pool.query(
        `${dedupCte}
         SELECT DATE(alerted_at AT TIME ZONE 'Asia/Jerusalem') AS date, COUNT(*) AS count
         FROM deduped
         GROUP BY date
         ORDER BY date ASC`,
        qParams
      ),
      pool.query(
        `${dedupCte}
         SELECT EXTRACT(HOUR FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
                COUNT(*) AS count
         FROM deduped
         GROUP BY hour
         ORDER BY hour ASC`,
        qParams
      ),
      pool.query(
        `${dedupCte}
         SELECT COUNT(*) AS total FROM deduped`,
        qParams
      ),
    ]);

    res.json({
      area,
      period: tc.label,
      total: parseInt(totalResult.rows[0]?.total || '0', 10),
      byType: byType.rows.map((r) => ({
        category: parseInt(r.category, 10),
        category_desc: r.category_desc,
        count: parseInt(r.count, 10),
      })),
      byDay: byDay.rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
      byHour: byHour.rows.map((r) => ({ hour: r.hour, count: parseInt(r.count, 10) })),
    });
  } catch (err) {
    console.error('[/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/summary?days=N  or  ?today=1
router.get('/summary', async (req, res) => {
  const tc = timeClause(req.query, 1);
  try {
    const [byType, totalResult] = await Promise.all([
      pool.query(
        `SELECT category_desc, COUNT(DISTINCT (area_name, alerted_at, category)) AS count
         FROM alerts WHERE ${tc.clause} AND ${EXCLUDE_FILTER}
         GROUP BY category_desc ORDER BY count DESC`,
        tc.params
      ),
      pool.query(
        `SELECT COUNT(DISTINCT (area_name, alerted_at, category)) AS total
         FROM alerts WHERE ${tc.clause} AND ${EXCLUDE_FILTER}`,
        tc.params
      ),
    ]);
    res.json({
      period: tc.label,
      total: parseInt(totalResult.rows[0]?.total || '0', 10),
      byType: byType.rows.map((r) => ({
        category_desc: r.category_desc,
        count: parseInt(r.count, 10),
      })),
    });
  } catch (err) {
    console.error('[/summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status — data collection range
router.get('/status', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT MIN(alerted_at) AS oldest, MAX(alerted_at) AS newest FROM alerts`
    );
    res.json({
      oldest: result.rows[0]?.oldest || null,
      newest: result.rows[0]?.newest || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
