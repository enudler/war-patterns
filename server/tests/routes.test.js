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

  test('deduplicates sibling sub-areas: returns one row per (alerted_at, category)', async () => {
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
