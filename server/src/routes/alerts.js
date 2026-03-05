const express = require('express');
const pool = require('../db/index');
const areasData = require('../data/areas.json');
const { getLiveAlerts } = require('../poller/oref');

const router = express.Router();

// Only include Rocket/Missile (1) and UAV/Drone (2) categories
const EXCLUDE_FILTER = `category IN (1, 2)`;

// Helper to sanitize error messages in production
function sanitizeError(err) {
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;
  return { error: message };
}

// Validate area parameter to prevent injection and provide better error messages
function validateAreaParam(req, res, next) {
  const area = req.params.area;

  if (!area || typeof area !== 'string') {
    return res.status(400).json({ error: 'Area parameter is required' });
  }

  if (area.length > 100) {
    return res.status(400).json({ error: 'Area parameter too long' });
  }

  // Basic validation: Hebrew characters, ASCII letters/numbers, spaces, hyphens, and common punctuation
  // This allows legitimate area names while blocking obvious injection attempts (SQL, XSS)
  const validPattern = /^[\u0590-\u05FFa-zA-Z0-9\s\-,'".()]+$/;
  if (!validPattern.test(area)) {
    return res.status(400).json({ error: 'Invalid area parameter format' });
  }

  next();
}

// Generate deduplication CTE for area-specific queries.
// Uses 3-minute bucketing to collapse sibling sub-areas and polling duplicates.
function dedupCte(predFilter) {
  return `
    WITH deduped AS (
      SELECT DISTINCT ON (date_bin('3 minutes', alerted_at, '1970-01-01'), category)
        alerted_at
      FROM alerts
      WHERE ${predFilter}
      ORDER BY date_bin('3 minutes', alerted_at, '1970-01-01'), category
    )
  `;
}

// Generate full deduplication CTE for stats queries (includes more columns).
function dedupCteWithColumns(predFilter) {
  return `
    WITH deduped AS (
      SELECT DISTINCT ON (date_bin('3 minutes', alerted_at, '1970-01-01'), category)
        alerted_at, category, category_desc
      FROM alerts
      WHERE ${predFilter}
      ORDER BY date_bin('3 minutes', alerted_at, '1970-01-01'), category
    )
  `;
}

// Extract the parent city name from an oref sub-area identifier.
// "אשקלון - דרום" → "אשקלון"
// "אשקלון"         → "אשקלון"
function baseAreaName(nameHe) {
  return nameHe.replace(/ - .*$/, '').trim();
}

// Match an area and all sibling subdivisions sharing the same base name.
// "אשקלון - דרום" → matches "אשקלון", "אשקלון - דרום", "אשקלון - צפון", etc.
// "אשקלון"         → matches "אשקלון", "אשקלון - דרום", "אשקלון - צפון", etc.
// Returns { clause, params, paramCount } for use in WHERE.
function areaClause(paramBase) {
  return `(area_name_he = $${paramBase} OR area_name_he LIKE $${paramBase + 1})`;
}
function areaParams(area) {
  const baseName = baseAreaName(area);
  return [baseName, `${baseName} - %`];
}

// GET /api/areas/all — all known areas with coords (no DB needed)
// Groups sub-areas under parent city names to match /api/areas grouping.
router.get('/areas/all', (_req, res) => {
  const grouped = {};
  for (const [name_he, v] of Object.entries(areasData)) {
    const base = baseAreaName(name_he);
    if (!grouped[base]) {
      grouped[base] = { area_name: v.name_en, area_name_he: base, lat: v.lat, lon: v.lon };
    }
  }
  res.json(Object.values(grouped));
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
// Groups sub-areas under their parent city (strips " - ..." suffix) so
// "תל אביב - מזרח" and "תל אביב - דרום" appear as one "תל אביב" marker.
// Uses DISTINCT ON to deduplicate alerts that fire across multiple sub-areas
// at the same timestamp (a single volley triggers many sub-areas simultaneously).
router.get('/areas', async (req, res) => {
  const tc = timeClause(req.query, 1);
  try {
    const result = await pool.query(
      `WITH base AS (
         SELECT
           REGEXP_REPLACE(area_name_he, ' - .*$', '') AS base_name_he,
           REGEXP_REPLACE(area_name, ' - .*$', '')    AS base_name_en,
           alerted_at, category, category_desc, lat, lon,
           area_name_he AS orig_name_he
         FROM alerts
         WHERE ${tc.clause}
           AND lat IS NOT NULL
           AND ${EXCLUDE_FILTER}
       ),
       deduped AS (
         SELECT DISTINCT ON (base_name_he, date_bin('3 minutes', alerted_at, '1970-01-01'), category)
           base_name_he, base_name_en, alerted_at, category, category_desc, lat, lon, orig_name_he
         FROM base
         ORDER BY base_name_he, date_bin('3 minutes', alerted_at, '1970-01-01'), category
       )
       SELECT
         base_name_he                                      AS area_name_he,
         MIN(base_name_en)                                 AS area_name,
         MIN(lat)                                          AS lat,
         MIN(lon)                                          AS lon,
         COUNT(*)                                          AS alert_count,
         MAX(alerted_at)                                   AS last_alert,
         MODE() WITHIN GROUP (ORDER BY category)           AS dominant_category,
         MODE() WITHIN GROUP (ORDER BY category_desc)      AS dominant_category_desc,
         COUNT(DISTINCT orig_name_he) > 1                  AS has_subdivisions,
         COUNT(DISTINCT orig_name_he)                      AS subdivision_count
       FROM deduped
       GROUP BY base_name_he
       ORDER BY alert_count DESC`,
      tc.params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[/areas]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
  }
});

// GET /api/areas/:area/alerts?days=N  or  ?today=1
// :area is the Hebrew area_name_he, URL-encoded in the path.
// Matches the selected area + parent + sibling subdivisions.
router.get('/areas/:area/alerts', validateAreaParam, async (req, res) => {
  const area = req.params.area;
  const tc = timeClause(req.query, 3);
  try {
    // DISTINCT ON (3-minute-bucketed alerted_at, category) collapses sibling
    // sub-areas AND near-duplicate rows (the poller can record the same active
    // alert every ~15 s with slightly different timestamps across minute
    // boundaries) into one row per 3-minute bucket+category.
    const result = await pool.query(
      `SELECT DISTINCT ON (date_bin('3 minutes', alerted_at, '1970-01-01'), category)
         id, oref_id, category, category_desc, area_name, area_name_he, lat, lon, alerted_at
       FROM alerts
       WHERE ${areaClause(1)}
         AND ${tc.clause}
         AND ${EXCLUDE_FILTER}
       ORDER BY date_bin('3 minutes', alerted_at, '1970-01-01') DESC, category
       LIMIT 100`,
      [...areaParams(area), ...tc.params]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[/alerts]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
  }
});

// GET /api/areas/:area/stats?days=N  or  ?today=1
// :area is the Hebrew area_name_he, URL-encoded in the path.
// Matches the selected area + parent + sibling subdivisions.
router.get('/areas/:area/stats', validateAreaParam, async (req, res) => {
  const area = req.params.area;
  const tc = timeClause(req.query, 3);
  const qParams = [...areaParams(area), ...tc.params];

  // DISTINCT ON (3-minute-bucketed alerted_at, category) collapses sibling
  // sub-areas AND near-duplicate rows from the poller (which can record the
  // same active alert every ~15 s across minute boundaries) so chart counts
  // reflect unique events.
  const dedupFilter = `${areaClause(1)} AND ${tc.clause} AND ${EXCLUDE_FILTER}`;
  const dedupSql = dedupCteWithColumns(dedupFilter);

  try {
    const [byType, byDay, byHour, totalResult] = await Promise.all([
      pool.query(
        `${dedupSql}
         SELECT category, category_desc, COUNT(*) AS count
         FROM deduped
         GROUP BY category, category_desc
         ORDER BY count DESC`,
        qParams
      ),
      pool.query(
        `${dedupSql}
         SELECT DATE(alerted_at AT TIME ZONE 'Asia/Jerusalem') AS date, COUNT(*) AS count
         FROM deduped
         GROUP BY date
         ORDER BY date ASC`,
        qParams
      ),
      pool.query(
        `${dedupSql}
         SELECT EXTRACT(HOUR FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
                COUNT(*) AS count
         FROM deduped
         GROUP BY hour
         ORDER BY hour ASC`,
        qParams
      ),
      pool.query(
        `${dedupSql}
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
    console.error('[/stats]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
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
    console.error('[/summary]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
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
router.get('/areas/:area/prediction', validateAreaParam, async (req, res) => {
  const area = req.params.area;

  try {
    const predFilter = `${areaClause(1)} AND ${EXCLUDE_FILTER}`;
    const predParams = areaParams(area);

    // Deduplicate using 3-minute bucketing to collapse sibling sub-areas and
    // near-duplicate polling rows into one alert per bucket+category, matching
    // the deduplication logic in /api/areas/:area/stats.
    const predDedupSql = dedupCte(predFilter);

    const [observationResult, hourlyResult, last24hResult, lastAlertResult, dowResult] =
      await Promise.all([
        // 1. Observation window
        pool.query(
          `${predDedupSql}
           SELECT
             COUNT(*) AS total_alerts,
             COUNT(DISTINCT DATE_TRUNC('hour', alerted_at AT TIME ZONE 'Asia/Jerusalem')) AS hours_with_alerts,
             EXTRACT(EPOCH FROM (MAX(alerted_at) - MIN(alerted_at))) / 3600.0 AS observation_hours
           FROM deduped`,
          predParams
        ),
        // 2. Hourly pattern (alerts per hour-of-day)
        pool.query(
          `${predDedupSql}
           SELECT
             EXTRACT(HOUR FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
             COUNT(*) AS count
           FROM deduped
           GROUP BY hour
           ORDER BY hour`,
          predParams
        ),
        // 3. Alerts in last 24 hours
        pool.query(
          `${predDedupSql}
           SELECT COUNT(*) AS count
           FROM deduped
           WHERE alerted_at >= NOW() - INTERVAL '24 hours'`,
          predParams
        ),
        // 4. Most recent alert
        pool.query(
          `${predDedupSql}
           SELECT MAX(alerted_at) AS last_alert
           FROM deduped`,
          predParams
        ),
        // 5. Day-of-week pattern
        pool.query(
          `${predDedupSql}
           SELECT
             EXTRACT(DOW FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
             COUNT(*) AS count
           FROM deduped
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
    const { israelHour, israelDay } = getIsraelTime();

    const prediction = computePrediction({
      totalAlerts, hoursWithAlerts, observationHours,
      hourlyMap, totalHourlyCounts,
      alertsLast24h, lastAlertTs,
      dowMap, totalDowCounts,
      israelHour, israelDay,
    });

    res.json({ area, ...prediction });
  } catch (err) {
    console.error('[/prediction]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
  }
});

// GET /api/areas/:area/prediction/timeline?hours=12
// Returns per-hour attack probability for the next N hours (default 12).
// Reuses the same 5 DB queries as /prediction but calls computePrediction once
// per hour — no extra DB round-trips needed since hourlyMap/dowMap already hold
// all 24-hour and 7-day pattern data.
router.get('/areas/:area/prediction/timeline', validateAreaParam, async (req, res) => {
  const area = req.params.area;
  const numHours = Math.min(Math.max(parseInt(req.query.hours || '12', 10), 1), 24);

  try {
    const predFilter = `${areaClause(1)} AND ${EXCLUDE_FILTER}`;
    const predParams = areaParams(area);

    const timelineDedupSql = dedupCte(predFilter);

    const [observationResult, hourlyResult, last24hResult, lastAlertResult, dowResult] =
      await Promise.all([
        pool.query(
          `${timelineDedupSql}
           SELECT
             COUNT(*) AS total_alerts,
             COUNT(DISTINCT DATE_TRUNC('hour', alerted_at AT TIME ZONE 'Asia/Jerusalem')) AS hours_with_alerts,
             EXTRACT(EPOCH FROM (MAX(alerted_at) - MIN(alerted_at))) / 3600.0 AS observation_hours
           FROM deduped`,
          predParams
        ),
        pool.query(
          `${timelineDedupSql}
           SELECT
             EXTRACT(HOUR FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
             COUNT(*) AS count
           FROM deduped
           GROUP BY hour
           ORDER BY hour`,
          predParams
        ),
        pool.query(
          `${timelineDedupSql}
           SELECT COUNT(*) AS count
           FROM deduped
           WHERE alerted_at >= NOW() - INTERVAL '24 hours'`,
          predParams
        ),
        pool.query(
          `${timelineDedupSql}
           SELECT MAX(alerted_at) AS last_alert
           FROM deduped`,
          predParams
        ),
        pool.query(
          `${timelineDedupSql}
           SELECT
             EXTRACT(DOW FROM alerted_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
             COUNT(*) AS count
           FROM deduped
           GROUP BY dow
           ORDER BY dow`,
          predParams
        ),
      ]);

    const obs = observationResult.rows[0];
    const totalAlerts      = parseInt(obs.total_alerts, 10);
    const hoursWithAlerts  = parseInt(obs.hours_with_alerts, 10);
    const observationHours = parseFloat(obs.observation_hours) || 0;

    const hourlyMap = {};
    let totalHourlyCounts = 0;
    for (const row of hourlyResult.rows) {
      hourlyMap[row.hour]  = parseInt(row.count, 10);
      totalHourlyCounts   += parseInt(row.count, 10);
    }

    const alertsLast24h = parseInt(last24hResult.rows[0].count, 10);
    const lastAlertTs   = lastAlertResult.rows[0].last_alert;

    const dowMap = {};
    let totalDowCounts = 0;
    for (const row of dowResult.rows) {
      dowMap[row.dow]  = parseInt(row.count, 10);
      totalDowCounts  += parseInt(row.count, 10);
    }

    const { israelHour, israelDay } = getIsraelTime();

    // Generate one prediction per future hour offset.
    // For offset h: advance the target hour/day and decay momentum as if h
    // more hours have elapsed since the most recent alert.
    const predictions = [];
    for (let offset = 0; offset < numHours; offset++) {
      const targetHour = (israelHour + offset) % 24;
      const dayRollover = Math.floor((israelHour + offset) / 24);
      const targetDay  = (israelDay + dayRollover) % 7;

      // Shift lastAlertTs back by `offset` hours so momentum decays correctly
      // for predictions further into the future.
      const adjustedLastAlertTs = lastAlertTs
        ? new Date(new Date(lastAlertTs).getTime() - offset * 3_600_000).toISOString()
        : null;

      const pred = computePrediction({
        totalAlerts, hoursWithAlerts, observationHours,
        hourlyMap, totalHourlyCounts,
        alertsLast24h,
        lastAlertTs: adjustedLastAlertTs,
        dowMap, totalDowCounts,
        israelHour: targetHour,
        israelDay:  targetDay,
      });

      predictions.push({
        hour:        targetHour,
        offset,
        label:       `${String(targetHour).padStart(2, '0')}:00`,
        probability: pred.probability,
        riskLevel:   pred.riskLevel,
        factors:     pred.factors,
        ...(offset === 0 ? { meta: pred.meta } : {}),
      });
    }

    res.json({ area, currentHour: israelHour, predictions });
  } catch (err) {
    console.error('[/prediction/timeline]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
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

// Calculate current Israel time (hour and day of week).
// Uses UTC+2 base offset plus DST adjustment (UTC+3 during summer).
function getIsraelTime(now = new Date()) {
  const israelOffset = 2;
  const dstShift = isDST(now) ? 1 : 0;
  const israelHour = (now.getUTCHours() + israelOffset + dstShift) % 24;
  const israelDay = new Date(now.getTime() + (israelOffset + dstShift) * 3_600_000).getUTCDay();
  return { israelHour, israelDay };
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
    console.error('[/status]', err.message, err.stack);
    res.status(500).json(sanitizeError(err));
  }
});

// GET /api/live — current active alerts from the oref live feed (no DB, no delay).
//
// Without ?area:  { active: false, areas: [] } or { active: true, areas, category, categoryDesc, alertDate }
// With ?area=<hebrewName>: performs base-city match on the server.
//   → { active: bool, category?, categoryDesc?, alertDate? }
//   The `areas` array is omitted — the caller only needs the boolean.
router.get('/live', async (req, res) => {
  try {
    const live = await getLiveAlerts();

    const areaFilter = typeof req.query.area === 'string' ? req.query.area.trim() : null;
    if (!areaFilter) {
      // No filter requested — return full payload as before.
      return res.json(live);
    }

    // Server-side base-city match: strip " - <suffix>" from both sides before comparing.
    const base = baseAreaName(areaFilter);
    const matched = live.active && live.areas.some(
      (a) => baseAreaName(a) === base
    );

    if (!matched) {
      return res.json({ active: false });
    }

    // Return the alarm metadata but omit the full areas list.
    return res.json({
      active: true,
      category:     live.category,
      categoryDesc: live.categoryDesc,
      alertDate:    live.alertDate,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = { baseAreaName, areaParams, timeClause, isDST, getIsraelTime, computePrediction };
