const express = require('express');
const pool = require('../db/index');
const areasData = require('../data/areas.json');

const router = express.Router();

// Only include Rocket/Missile (1) and UAV/Drone (2) categories
const EXCLUDE_FILTER = `category IN (1, 2)`;

// Match an area and all sibling subdivisions sharing the same base name.
// "אשקלון - דרום" → matches "אשקלון", "אשקלון - דרום", "אשקלון - צפון", etc.
// "אשקלון"         → matches "אשקלון", "אשקלון - דרום", "אשקלון - צפון", etc.
// Returns { clause, params, paramCount } for use in WHERE.
function areaClause(paramBase) {
  return `(area_name_he = $${paramBase} OR area_name_he LIKE $${paramBase + 1})`;
}
function areaParams(area) {
  const baseName = area.replace(/ - .*$/, '').trim();
  return [baseName, `${baseName} - %`];
}

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

// GET /api/areas/:area/alerts?days=N  or  ?today=1
// :area is the Hebrew area_name_he, URL-encoded in the path.
// Matches the selected area + parent + sibling subdivisions.
router.get('/areas/:area/alerts', async (req, res) => {
  const area = req.params.area;
  const tc = timeClause(req.query, 3);
  try {
    // DISTINCT ON (alerted_at, category) collapses sibling sub-areas that fired
    // at exactly the same timestamp into one row, eliminating duplicate entries
    // in the sidebar list (e.g. "אשקלון - דרום" and "אשקלון - צפון" at 12:00).
    const result = await pool.query(
      `SELECT DISTINCT ON (alerted_at, category)
         id, oref_id, category, category_desc, area_name, area_name_he, lat, lon, alerted_at
       FROM alerts
       WHERE ${areaClause(1)}
         AND ${tc.clause}
         AND ${EXCLUDE_FILTER}
       ORDER BY alerted_at DESC, category
       LIMIT 100`,
      [...areaParams(area), ...tc.params]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[/alerts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/areas/:area/stats?days=N  or  ?today=1
// :area is the Hebrew area_name_he, URL-encoded in the path.
// Matches the selected area + parent + sibling subdivisions.
router.get('/areas/:area/stats', async (req, res) => {
  const area = req.params.area;
  const tc = timeClause(req.query, 3);
  const qParams = [...areaParams(area), ...tc.params];

  // DISTINCT ON (alerted_at, category) collapses sibling sub-areas (e.g.
  // "אשקלון - דרום" + "אשקלון - צפון") that fired at the same timestamp so
  // chart counts and totals reflect unique events, not per-sub-area rows.
  const dedupCte = `
    WITH deduped AS (
      SELECT DISTINCT ON (alerted_at, category) alerted_at, category, category_desc
      FROM alerts
      WHERE ${areaClause(1)}
        AND ${tc.clause}
        AND ${EXCLUDE_FILTER}
      ORDER BY alerted_at, category
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

/**
 * Pure prediction computation — isolated from DB and HTTP concerns.
 * Accepts pre-processed query results and current Israel time context.
 *
 * Improvements over the original inline model:
 *  - Laplace-smoothed base rate (Beta(1,1) prior) stabilises sparse estimates
 *    and prevents the 0/1 extremes that hurt log-odds arithmetic.
 *  - Adaptive shrinkage (κ) on hourly and DOW ratios: κ grows when data is thin,
 *    pulling noisy factors back toward neutral (1.0).
 *  - dataConfidence scalar (0→1 over first 50 alerts) scales all pattern-factor
 *    weights so sparse history cannot produce wildly overconfident predictions.
 *  - Factors explicitly clamped to [0.1, 10] before log() replaces the ad-hoc
 *    safeLog(max(x, 0.01)) floor, keeping logit adjustments in a sane range.
 */
function computePrediction({
  totalAlerts,
  hoursWithAlerts,
  observationHours,
  hourlyMap,
  totalHourlyCounts,
  alertsLast24h,
  lastAlertTs,
  dowMap,
  totalDowCounts,
  israelHour,
  israelDay,
}) {
  if (totalAlerts === 0) {
    return {
      probability: 0,
      riskLevel: 'none',
      factors: { baseRate: 0, hourlyFactor: 1, trendFactor: 1, momentumScore: 0, dowFactor: 1 },
      meta: {
        totalAlerts: 0,
        observationHours: 0,
        hoursSinceLastAlert: null,
        alertsLast24h: 0,
        currentHour: israelHour,
      },
    };
  }

  const totalHourSlots = Math.max(observationHours, 24);

  // Factor 1: Laplace-smoothed base rate
  // Equivalent to a Beta(1,1) prior — avoids 0/1 and shrinks toward 0.5 when
  // the observation window is very short.
  const baseRate = (hoursWithAlerts + 1) / (totalHourSlots + 2);

  // Data confidence: ramps 0→1 as total alerts grow from 0 to 50.
  // Multiplied into every pattern-factor weight so thin data leans on base rate.
  const dataConfidence = Math.min(1, totalAlerts / 50);

  // Clamp any ratio factor to [0.1, 10] so log stays in [-2.3, 2.3].
  const clampFactor = (x) => Math.max(0.1, Math.min(10, x));

  // Factor 2: Hour-of-day with adaptive shrinkage
  // κ_h is 10% of the mean when data is plentiful, up to 110% when data is sparse.
  const avgPerHour = totalHourlyCounts / 24;
  const κ_h = Math.max(0.5, avgPerHour * (1.1 - dataConfidence));
  const currentHourCount = hourlyMap[israelHour] || 0;
  const hourlyFactor = clampFactor((currentHourCount + κ_h) / (avgPerHour + κ_h));

  // Factor 3: 24-hour trend — recent alert rate vs overall rate
  const overallRate = totalAlerts / Math.max(observationHours, 1);
  const recentRate  = alertsLast24h / 24;
  const κ_t = Math.max(0.01, overallRate * 0.5);
  const trendFactor = clampFactor((recentRate + κ_t) / (overallRate + κ_t));

  // Factor 4: Momentum — exponential decay from most recent alert
  const hoursSinceLastAlert = lastAlertTs
    ? (Date.now() - new Date(lastAlertTs).getTime()) / 3_600_000
    : Infinity;
  const momentumScore = hoursSinceLastAlert === Infinity
    ? 0
    : Math.exp(-0.5 * hoursSinceLastAlert);

  // Factor 5: Day-of-week with adaptive shrinkage (same logic as hourly)
  const avgPerDow = totalDowCounts / 7;
  const κ_d = Math.max(0.5, avgPerDow * (1.1 - dataConfidence));
  const currentDowCount = dowMap[israelDay] || 0;
  const dowFactor = clampFactor((currentDowCount + κ_d) / (avgPerDow + κ_d));

  // Combine via log-odds. Pattern weights scaled by dataConfidence.
  const clampedBase = Math.max(0.005, Math.min(0.995, baseRate));
  let logit = Math.log(clampedBase / (1 - clampedBase));

  logit += dataConfidence * 0.6 * Math.log(hourlyFactor);
  logit += dataConfidence * 0.4 * Math.log(trendFactor);
  logit += dataConfidence * 0.3 * Math.log(dowFactor);
  logit += dataConfidence * 2.0 * momentumScore;

  const probability = 1 / (1 + Math.exp(-logit));

  let riskLevel;
  if      (probability < 0.05) riskLevel = 'very_low';
  else if (probability < 0.15) riskLevel = 'low';
  else if (probability < 0.35) riskLevel = 'moderate';
  else if (probability < 0.60) riskLevel = 'high';
  else if (probability < 0.80) riskLevel = 'very_high';
  else                         riskLevel = 'critical';

  return {
    probability: Math.round(probability * 1000) / 1000,
    riskLevel,
    factors: {
      baseRate:      Math.round(baseRate * 1000) / 1000,
      hourlyFactor:  Math.round(hourlyFactor * 100) / 100,
      trendFactor:   Math.round(trendFactor * 100) / 100,
      momentumScore: Math.round(momentumScore * 1000) / 1000,
      dowFactor:     Math.round(dowFactor * 100) / 100,
    },
    meta: {
      totalAlerts,
      observationHours: Math.round(observationHours * 10) / 10,
      hoursSinceLastAlert: hoursSinceLastAlert === Infinity
        ? null
        : Math.round(hoursSinceLastAlert * 10) / 10,
      alertsLast24h,
      currentHour: israelHour,
    },
  };
}

// GET /api/areas/:area/prediction
// :area is the Hebrew area_name_he, URL-encoded in the path.
// Multi-factor probability model for attack in the next hour.
//
// Factors combined via log-odds (logistic) approach:
//   1. Base rate   — Laplace-smoothed fraction of hour-slots with ≥1 alert
//   2. Hour-of-day — current hour's historical frequency vs average
//   3. Trend       — last-24 h alert rate vs overall rate
//   4. Momentum    — exponential decay from time since last alert
//   5. Day-of-week — current weekday's frequency vs average
router.get('/areas/:area/prediction', async (req, res) => {
  const area = req.params.area;

  try {
    const predFilter = `${areaClause(1)} AND ${EXCLUDE_FILTER}`;
    const predParams = areaParams(area);

    const [observationResult, hourlyResult, last24hResult, lastAlertResult, dowResult] =
      await Promise.all([
        // 1. Observation window
        pool.query(
          `SELECT
             COUNT(*) AS total_alerts,
             COUNT(DISTINCT DATE_TRUNC('hour', alerted_at AT TIME ZONE 'Asia/Jerusalem')) AS hours_with_alerts,
             EXTRACT(EPOCH FROM (MAX(alerted_at) - MIN(alerted_at))) / 3600.0 AS observation_hours
           FROM alerts
           WHERE ${predFilter}`,
          predParams
        ),
        // 2. Hourly pattern (alerts per hour-of-day)
        pool.query(
          `SELECT
             EXTRACT(HOUR FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
             COUNT(*) AS count
           FROM alerts
           WHERE ${predFilter}
           GROUP BY hour
           ORDER BY hour`,
          predParams
        ),
        // 3. Alerts in last 24 hours
        pool.query(
          `SELECT COUNT(*) AS count
           FROM alerts
           WHERE ${predFilter}
             AND alerted_at >= NOW() - INTERVAL '24 hours'`,
          predParams
        ),
        // 4. Most recent alert
        pool.query(
          `SELECT MAX(alerted_at) AS last_alert
           FROM alerts
           WHERE ${predFilter}`,
          predParams
        ),
        // 5. Day-of-week pattern
        pool.query(
          `SELECT
             EXTRACT(DOW FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
             COUNT(*) AS count
           FROM alerts
           WHERE ${predFilter}
           GROUP BY dow
           ORDER BY dow`,
          predParams
        ),
      ]);

    const obs = observationResult.rows[0];
    const totalAlerts     = parseInt(obs.total_alerts, 10);
    const hoursWithAlerts = parseInt(obs.hours_with_alerts, 10);
    const observationHours = parseFloat(obs.observation_hours) || 0;

    const hourlyMap = {};
    let totalHourlyCounts = 0;
    for (const row of hourlyResult.rows) {
      hourlyMap[row.hour] = parseInt(row.count, 10);
      totalHourlyCounts  += parseInt(row.count, 10);
    }

    const alertsLast24h = parseInt(last24hResult.rows[0].count, 10);
    const lastAlertTs   = lastAlertResult.rows[0].last_alert;

    const dowMap = {};
    let totalDowCounts = 0;
    for (const row of dowResult.rows) {
      dowMap[row.dow]  = parseInt(row.count, 10);
      totalDowCounts  += parseInt(row.count, 10);
    }

    // Israel-time hour & weekday (UTC offset + DST approximation)
    const now          = new Date();
    const israelOffset = 2;
    const dstShift     = isDST(now) ? 1 : 0;
    const israelHour   = (now.getUTCHours() + israelOffset + dstShift) % 24;
    const israelDay    = new Date(now.getTime() + (israelOffset + dstShift) * 3_600_000).getUTCDay();

    const prediction = computePrediction({
      totalAlerts, hoursWithAlerts, observationHours,
      hourlyMap, totalHourlyCounts,
      alertsLast24h, lastAlertTs,
      dowMap, totalDowCounts,
      israelHour, israelDay,
    });

    res.json({ area, ...prediction });
  } catch (err) {
    console.error('[/prediction]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Rough Israel DST check (last-Friday-in-March to last-Sunday-in-October)
function isDST(date) {
  const month = date.getUTCMonth(); // 0-based
  if (month > 2 && month < 9) return true;  // Apr–Sep always DST
  if (month < 2 || month > 9) return false;  // Nov–Feb never DST
  // March: DST starts last Friday at 02:00
  if (month === 2) {
    const lastFri = 31 - ((new Date(Date.UTC(date.getUTCFullYear(), 2, 31)).getUTCDay() + 2) % 7);
    return date.getUTCDate() >= lastFri;
  }
  // October: DST ends last Sunday at 02:00
  const lastSun = 31 - new Date(Date.UTC(date.getUTCFullYear(), 9, 31)).getUTCDay();
  return date.getUTCDate() < lastSun;
}

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
module.exports._test = { areaParams, timeClause, isDST, computePrediction };
