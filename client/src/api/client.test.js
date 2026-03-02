import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: () => ({ get: mockGet }),
  },
}));

import {
  fetchAreas,
  fetchStats,
  fetchAlerts,
  fetchSummary,
  fetchAllAreas,
  fetchStatus,
  fetchPrediction,
  fetchPredictionTimeline,
} from './client.js';

beforeEach(() => {
  mockGet.mockClear();
  mockGet.mockResolvedValue({ data: [] });
});

// ---------------------------------------------------------------------------
describe('fetchAreas', () => {
  test('calls /api/areas with { days } for a numeric period', async () => {
    await fetchAreas(7);
    expect(mockGet).toHaveBeenCalledWith('/api/areas', { params: { days: 7 } });
  });

  test('calls /api/areas with { today: 1 } for "today" period', async () => {
    await fetchAreas('today');
    expect(mockGet).toHaveBeenCalledWith('/api/areas', { params: { today: 1 } });
  });

  test('returns the data from the response', async () => {
    const areas = [{ area_name: 'Tel Aviv' }];
    mockGet.mockResolvedValue({ data: areas });
    const result = await fetchAreas(3);
    expect(result).toEqual(areas);
  });
});

// ---------------------------------------------------------------------------
describe('fetchStats  (RESTful path param)', () => {
  test('encodes area as a path segment and passes days as a query param', async () => {
    await fetchStats('תל אביב', 7);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('תל אביב')}/stats`,
      { params: { days: 7 } }
    );
  });

  test('uses today=1 query param for "today" period', async () => {
    await fetchStats('אשקלון', 'today');
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('אשקלון')}/stats`,
      { params: { today: 1 } }
    );
  });

  test('does NOT pass area as a query param', async () => {
    await fetchStats('Test', 5);
    const [, options] = mockGet.mock.calls[0];
    expect(options.params).not.toHaveProperty('area');
  });
});

// ---------------------------------------------------------------------------
describe('fetchAlerts  (RESTful path param)', () => {
  test('encodes area as a path segment and passes days as a query param', async () => {
    await fetchAlerts('תל אביב', 5);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('תל אביב')}/alerts`,
      { params: { days: 5 } }
    );
  });

  test('uses today=1 query param for "today" period', async () => {
    await fetchAlerts('אשקלון', 'today');
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('אשקלון')}/alerts`,
      { params: { today: 1 } }
    );
  });

  test('does NOT pass area as a query param', async () => {
    await fetchAlerts('Test', 5);
    const [, options] = mockGet.mock.calls[0];
    expect(options.params).not.toHaveProperty('area');
  });
});

// ---------------------------------------------------------------------------
describe('fetchSummary', () => {
  test('calls /api/summary with days param', async () => {
    await fetchSummary(3);
    expect(mockGet).toHaveBeenCalledWith('/api/summary', { params: { days: 3 } });
  });

  test('calls /api/summary with today=1 for "today" period', async () => {
    await fetchSummary('today');
    expect(mockGet).toHaveBeenCalledWith('/api/summary', { params: { today: 1 } });
  });
});

// ---------------------------------------------------------------------------
describe('fetchAllAreas', () => {
  test('calls /api/areas/all with no params', async () => {
    await fetchAllAreas();
    expect(mockGet).toHaveBeenCalledWith('/api/areas/all');
  });

  test('returns the data from the response', async () => {
    const areas = [{ area_name_he: 'תל אביב' }];
    mockGet.mockResolvedValue({ data: areas });
    const result = await fetchAllAreas();
    expect(result).toEqual(areas);
  });
});

// ---------------------------------------------------------------------------
describe('fetchStatus', () => {
  test('calls /api/status with no params', async () => {
    await fetchStatus();
    expect(mockGet).toHaveBeenCalledWith('/api/status');
  });
});

// ---------------------------------------------------------------------------
describe('fetchPrediction  (RESTful path param)', () => {
  test('encodes area as a path segment with no query params', async () => {
    await fetchPrediction('תל אביב');
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('תל אביב')}/prediction`
    );
  });

  test('does NOT pass area as a query param', async () => {
    await fetchPrediction('Test');
    const call = mockGet.mock.calls[0];
    // Only the URL string is passed — no options object
    expect(call).toHaveLength(1);
  });

  test('returns prediction data from the response', async () => {
    const prediction = { probability: 0.42, riskLevel: 'moderate' };
    mockGet.mockResolvedValue({ data: prediction });
    const result = await fetchPrediction('אשקלון');
    expect(result).toEqual(prediction);
  });
});

// ---------------------------------------------------------------------------
describe('fetchPredictionTimeline  (RESTful path param)', () => {
  test('calls the timeline endpoint with default hours=12', async () => {
    await fetchPredictionTimeline('תל אביב');
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('תל אביב')}/prediction/timeline`,
      { params: { hours: 12 } }
    );
  });

  test('passes custom hours param', async () => {
    await fetchPredictionTimeline('אשקלון', 6);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/areas/${encodeURIComponent('אשקלון')}/prediction/timeline`,
      { params: { hours: 6 } }
    );
  });

  test('returns timeline data from the response', async () => {
    const timeline = { area: 'אשקלון', currentHour: 14, predictions: [] };
    mockGet.mockResolvedValue({ data: timeline });
    const result = await fetchPredictionTimeline('אשקלון');
    expect(result).toEqual(timeline);
  });
});
