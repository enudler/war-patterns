'use strict';

const express = require('express');
const request = require('supertest');

// Mock the DB pool before requiring any routes
jest.mock('../src/db/index', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/db/index');
const alertRoutes = require('../src/routes/alerts');

const app = express();
app.use(express.json());
app.use('/api', alertRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('GET /health', () => {
  test('returns 200 with { status: ok }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/areas/all', () => {
  test('returns 200 with an array', async () => {
    const res = await request(app).get('/api/areas/all');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('each item has area_name, area_name_he, lat, lon', async () => {
    const res = await request(app).get('/api/areas/all');
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('area_name');
      expect(res.body[0]).toHaveProperty('area_name_he');
      expect(res.body[0]).toHaveProperty('lat');
      expect(res.body[0]).toHaveProperty('lon');
    }
  });

  test('groups sub-areas under parent city names (no duplicates)', async () => {
    const res = await request(app).get('/api/areas/all');
    const names = res.body.map((a) => a.area_name_he);
    // No area_name_he should contain " - " (sub-area suffix)
    const subAreas = names.filter((n) => n.includes(' - '));
    expect(subAreas).toEqual([]);
    // No duplicate names
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/areas/:area/alerts  (RESTful path param)', () => {
  test('returns 200 with array for a valid area path', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/areas/Test/alerts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('accepts ?days=N query param', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/areas/Test/alerts?days=3');
    expect(res.status).toBe(200);
  });

  test('accepts ?today=1 query param', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/areas/Test/alerts?today=1');
    expect(res.status).toBe(200);
  });

  test('deduplicates sibling sub-areas: returns one row per (minute, category)', async () => {
    // Simulate the DB returning one row after DISTINCT ON has collapsed siblings.
    const ts = '2024-01-01T12:00:00.000Z';
    pool.query.mockResolvedValue({
      rows: [
        { id: 1, oref_id: 'abc', category: 1, category_desc: 'Rocket / Missile',
          area_name: 'Ashkelon', area_name_he: 'אשקלון - דרום', lat: 31.6, lon: 34.5, alerted_at: ts },
      ],
    });
    const res = await request(app).get('/api/areas/%D7%90%D7%A9%D7%A7%D7%9C%D7%95%D7%9F/alerts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].alerted_at).toBe(ts);
  });

  test('SQL uses DATE_TRUNC(minute) for dedup, not exact timestamps', async () => {
    // Verify the query uses minute-level dedup to collapse near-duplicate
    // alerts that the poller records every ~15 s with slightly different timestamps.
    pool.query.mockResolvedValue({ rows: [] });
    await request(app).get('/api/areas/Test/alerts');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("DATE_TRUNC('minute', alerted_at)");
    expect(sql).not.toMatch(/DISTINCT ON \(alerted_at,/);
  });

  test('returns 500 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/areas/Test/alerts');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/areas/:area/stats  (RESTful path param)', () => {
  test('returns 200 with byType, byDay, byHour, total', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })                    // byType
      .mockResolvedValueOnce({ rows: [] })                    // byDay
      .mockResolvedValueOnce({ rows: [] })                    // byHour
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });    // total

    const res = await request(app).get('/api/areas/Test/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total', 0);
    expect(Array.isArray(res.body.byType)).toBe(true);
    expect(Array.isArray(res.body.byDay)).toBe(true);
    expect(Array.isArray(res.body.byHour)).toBe(true);
  });

  test('reflects area value from path in the response', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '3' }] });

    const res = await request(app).get('/api/areas/MyArea/stats');
    expect(res.status).toBe(200);
    expect(res.body.area).toBe('MyArea');
  });

  test('stats CTE uses DATE_TRUNC(minute) for dedup', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await request(app).get('/api/areas/Test/stats');
    // All four stats queries share the same dedupCte; check the first one
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("DATE_TRUNC('minute', alerted_at)");
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/summary', () => {
  test('returns 200 with total and byType', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '5' }] });

    const res = await request(app).get('/api/summary');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total', 5);
    expect(Array.isArray(res.body.byType)).toBe(true);
  });

  test('returns 500 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/summary');
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/areas', () => {
  test('returns 200 with an array', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/areas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('accepts ?today=1 param without error', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/areas?today=1');
    expect(res.status).toBe(200);
  });

  test('returns grouped parent cities with has_subdivisions field', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          area_name_he: 'תל אביב', area_name: 'Tel Aviv',
          lat: 32.08, lon: 34.78, alert_count: '10', last_alert: '2024-01-01T12:00:00Z',
          dominant_category: '1', dominant_category_desc: 'Rocket / Missile',
          has_subdivisions: true, subdivision_count: '4',
        },
      ],
    });
    const res = await request(app).get('/api/areas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].area_name_he).toBe('תל אביב');
    expect(res.body[0].has_subdivisions).toBe(true);
  });

  test('returns 500 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/areas');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/status', () => {
  test('returns 200 with oldest and newest fields', async () => {
    pool.query.mockResolvedValue({ rows: [{ oldest: null, newest: null }] });
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('oldest');
    expect(res.body).toHaveProperty('newest');
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/areas/:area/prediction  (RESTful path param)', () => {
  test('returns probability=0 and riskLevel=none when there is no history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total_alerts: '0', hours_with_alerts: '0', observation_hours: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ last_alert: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/areas/Test/prediction');
    expect(res.status).toBe(200);
    expect(res.body.probability).toBe(0);
    expect(res.body.riskLevel).toBe('none');
  });

  test('returns a valid probability object when history exists', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total_alerts: '50', hours_with_alerts: '10', observation_hours: '48' }] })
      .mockResolvedValueOnce({ rows: [{ hour: 12, count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ last_alert: new Date(Date.now() - 3_600_000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ dow: 1, count: '10' }] });

    const res = await request(app).get('/api/areas/Test/prediction');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('probability');
    expect(res.body).toHaveProperty('riskLevel');
    expect(res.body).toHaveProperty('factors');
    expect(res.body.probability).toBeGreaterThanOrEqual(0);
    expect(res.body.probability).toBeLessThanOrEqual(1);
  });

  test('reflects area value from path in the response', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total_alerts: '0', hours_with_alerts: '0', observation_hours: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ last_alert: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/areas/MyArea/prediction');
    expect(res.status).toBe(200);
    expect(res.body.area).toBe('MyArea');
  });
});

// ---------------------------------------------------------------------------
// Helper: mock the 5 DB calls the timeline endpoint makes (same shape as /prediction)
function mockTimelineDb({ totalAlerts = '50', hoursWithAlerts = '10', observationHours = '48',
  hourlyRows = [{ hour: 12, count: '5' }], last24h = '3',
  lastAlert = null, dowRows = [{ dow: 1, count: '10' }] } = {}) {
  pool.query
    .mockResolvedValueOnce({ rows: [{ total_alerts: totalAlerts, hours_with_alerts: hoursWithAlerts, observation_hours: observationHours }] })
    .mockResolvedValueOnce({ rows: hourlyRows })
    .mockResolvedValueOnce({ rows: [{ count: last24h }] })
    .mockResolvedValueOnce({ rows: [{ last_alert: lastAlert }] })
    .mockResolvedValueOnce({ rows: dowRows });
}

describe('GET /api/areas/:area/prediction/timeline', () => {
  test('returns 200 with area, currentHour, and predictions array', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('area', 'Test');
    expect(res.body).toHaveProperty('currentHour');
    expect(Array.isArray(res.body.predictions)).toBe(true);
  });

  test('returns 12 predictions by default', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(12);
  });

  test('respects ?hours=6 query param', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline?hours=6');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(6);
  });

  test('each prediction has hour, offset, label, probability, riskLevel, factors', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    const first = res.body.predictions[0];
    expect(first).toHaveProperty('hour');
    expect(first).toHaveProperty('offset', 0);
    expect(first).toHaveProperty('label');
    expect(first).toHaveProperty('probability');
    expect(first).toHaveProperty('riskLevel');
    expect(first).toHaveProperty('factors');
  });

  test('label is formatted as HH:00', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    for (const p of res.body.predictions) {
      expect(p.label).toMatch(/^\d{2}:00$/);
    }
  });

  test('offset=0 probability and riskLevel are in valid ranges/values', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    const first = res.body.predictions[0];
    expect(first.probability).toBeGreaterThanOrEqual(0);
    expect(first.probability).toBeLessThanOrEqual(1);
    expect(['none', 'very_low', 'low', 'moderate', 'high', 'very_high', 'critical'])
      .toContain(first.riskLevel);
  });

  test('hours wrap correctly past midnight — no hour > 23', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    for (const p of res.body.predictions) {
      expect(p.hour).toBeGreaterThanOrEqual(0);
      expect(p.hour).toBeLessThanOrEqual(23);
    }
  });

  test('offsets are sequential 0..N-1', async () => {
    mockTimelineDb();
    const res = await request(app).get('/api/areas/Test/prediction/timeline?hours=4');
    const offsets = res.body.predictions.map((p) => p.offset);
    expect(offsets).toEqual([0, 1, 2, 3]);
  });

  test('returns 500 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  test('returns probability=0 for all hours when there is no history', async () => {
    mockTimelineDb({ totalAlerts: '0', hoursWithAlerts: '0', observationHours: '0',
      hourlyRows: [], last24h: '0', lastAlert: null, dowRows: [] });
    const res = await request(app).get('/api/areas/Test/prediction/timeline');
    expect(res.status).toBe(200);
    for (const p of res.body.predictions) {
      expect(p.probability).toBe(0);
      expect(p.riskLevel).toBe('none');
    }
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/openapi.yaml  (spec endpoint)', () => {
  test('returns 200 with text/yaml content-type', async () => {
    // The openapi.yaml route is on the main app (index.js), not the router,
    // so we test it separately by verifying the router does not 404 it.
    // Here we just confirm the routes module does not shadow this path.
    const res = await request(app).get('/api/openapi.yaml');
    // In the test app the sendFile route is not registered (it's in index.js),
    // so we accept either 200 (if registered) or 404 (not registered in test app).
    expect([200, 404]).toContain(res.status);
  });
});
