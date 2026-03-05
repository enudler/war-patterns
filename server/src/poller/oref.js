const axios = require('axios');
const crypto = require('crypto');
const pool = require('../db/index');
const areas = require('../data/areas.json');

const HISTORY_URL =
  'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';
const LIVE_URL =
  'https://www.oref.org.il/WarningMessages/alert/alerts.json';

// Actual API uses `category` field (not `cat`) and `data` as a plain string
const CATEGORY_MAP = {
  1:  'Rocket / Missile',
  2:  'UAV / Drone',
  3:  'Earthquake',
  4:  'Radiological',
  5:  'Chemical',
  6:  'Tsunami',
  7:  'Hostile Aircraft',
  8:  'Unconventional Missile',
  9:  'Infrastructure Hazard',
  10: 'Pre-Alert',
  13: 'All Clear',
};

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'User-Agent': 'Mozilla/5.0 (compatible; war-patterns-poller/1.0)',
};

function geocode(hebrewName) {
  const entry = areas[hebrewName];
  if (entry) return { lat: entry.lat, lon: entry.lon, name_en: entry.name_en };
  // Fuzzy fallback: strip trailing " - ..." and retry
  const base = hebrewName.replace(/ - .*$/, '').trim();
  const fallback = areas[base];
  if (fallback) return { lat: fallback.lat, lon: fallback.lon, name_en: fallback.name_en };
  return { lat: null, lon: null, name_en: hebrewName };
}

// Stable dedup key: sha1 of 3-minute-bucketed alertDate + area name.
// Bucketing prevents duplicate rows when the oref live endpoint returns
// an updated alertDate for the same active alert on every 15-second poll.
function makeOrefId(alertDate, areaName) {
  const dateMs = new Date(alertDate.replace(' ', 'T')).getTime();
  const bucketMs = Math.floor(dateMs / (3 * 60_000)) * (3 * 60_000);
  const bucketStr = new Date(bucketMs).toISOString();
  return crypto
    .createHash('sha1')
    .update(`${bucketStr}|${areaName}`)
    .digest('hex')
    .slice(0, 28);
}

async function fetchAlerts(url) {
  try {
    const resp = await axios.get(url, {
      headers: OREF_HEADERS,
      timeout: 8000,
      responseType: 'text',
    });
    const text = (resp.data || '').trim();
    if (!text) return [];
    const parsed = JSON.parse(text);

    // History endpoint returns an array of flat objects
    if (Array.isArray(parsed)) return parsed;

    // Live endpoint returns a single object: { id, cat, title, data: [...], alertDate }
    if (parsed && parsed.data) {
      const dataArr = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      return dataArr.map((area) => ({
        alertDate: parsed.alertDate || new Date().toISOString(),
        category: parsed.cat || parsed.category || 0,
        data: area,
      }));
    }
    return [];
  } catch (err) {
    if (err.response?.status === 204 || err.response?.status === 304) return [];
    console.error(`[poller] fetch error ${url}: ${err.message}`);
    return [];
  }
}

async function insertAlerts(rawAlerts) {
  if (!rawAlerts.length) return;

  const client = await pool.connect();
  let inserted = 0;
  try {
    for (const alert of rawAlerts) {
      // History API: data is a plain string area name, category (not cat)
      const heArea = typeof alert.data === 'string' ? alert.data.trim() : null;
      if (!heArea || !alert.alertDate) continue;

      const cat = parseInt(alert.category ?? alert.cat ?? 0, 10);
      const catDesc = CATEGORY_MAP[cat] || `Unknown (${cat})`;
      const alertDate = new Date(alert.alertDate.replace(' ', 'T'));
      const orefId = makeOrefId(alert.alertDate, heArea);
      const { lat, lon, name_en } = geocode(heArea);

      const res = await client.query(
        `INSERT INTO alerts
           (oref_id, category, category_desc, area_name, area_name_he, lat, lon, alerted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (oref_id) DO NOTHING`,
        [orefId, cat, catDesc, name_en, heArea, lat, lon, alertDate]
      );
      inserted += res.rowCount || 0;
    }
  } finally {
    client.release();
  }
  if (inserted > 0) console.log(`[poller] Inserted ${inserted} new alert rows`);
}

async function poll() {
  const [history, live] = await Promise.all([
    fetchAlerts(HISTORY_URL),
    fetchAlerts(LIVE_URL),
  ]);
  await insertAlerts([...history, ...live]);
}

function startPoller(intervalMs = 15000) {
  console.log(`[poller] Starting — interval ${intervalMs}ms`);

  // Safe polling wrapper with explicit error handling
  const safePoll = async () => {
    try {
      await poll();
    } catch (err) {
      console.error('[poller] Error during poll cycle:', err.message, err.stack);
      // Continue polling even after errors - don't let one failure stop the poller
    }
  };

  // Initial poll
  safePoll();

  // Set up recurring polls
  const intervalId = setInterval(safePoll, intervalMs);

  // Return cleanup function (useful for graceful shutdown)
  return () => {
    console.log('[poller] Stopping');
    clearInterval(intervalId);
  };
}

// Returns the current live alert state directly from the oref API (no DB).
// { active: false, areas: [] } when quiet.
// { active: true, areas: [...hebrewNames], category, categoryDesc, alertDate } when firing.
async function getLiveAlerts() {
  const raw = await fetchAlerts(LIVE_URL);
  if (!raw.length) return { active: false, areas: [] };
  const category = parseInt(raw[0].category ?? 0, 10);
  const areas = raw.map((r) => r.data).filter(Boolean);
  if (!areas.length) return { active: false, areas: [] };
  return {
    active: true,
    areas,
    category,
    categoryDesc: CATEGORY_MAP[category] || `Unknown (${category})`,
    alertDate: raw[0].alertDate,
  };
}

module.exports = { startPoller, getLiveAlerts };
module.exports._test = { geocode, makeOrefId, fetchAlerts };
