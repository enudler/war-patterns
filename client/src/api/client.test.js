import { describe, test, expect, vi, beforeEach } from 'vitest';

// Hoist the mock fn so it is available inside the vi.mock factory
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
} from './client.js';

beforeEach(() => {
  mockGet.mockResolvedValue({ data: [] });
});

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

describe('fetchStats', () => {
  test('calls /api/stats with area and days params', async () => {
    await fetchStats('תל אביב', 7);
    expect(mockGet).toHaveBeenCalledWith('/api/stats', {
      params: { area: 'תל אביב', days: 7 },
    });
  });

  test('calls /api/stats with area and today=1 for "today" period', async () => {
    await fetchStats('אשקלון', 'today');
    expect(mockGet).toHaveBeenCalledWith('/api/stats', {
      params: { area: 'אשקלון', today: 1 },
    });
  });
});

describe('fetchAlerts', () => {
  test('calls /api/alerts with area and days params', async () => {
    await fetchAlerts('תל אביב', 5);
    expect(mockGet).toHaveBeenCalledWith('/api/alerts', {
      params: { area: 'תל אביב', days: 5 },
    });
  });

  test('calls /api/alerts with today=1 for "today" period', async () => {
    await fetchAlerts('אשקלון', 'today');
    expect(mockGet).toHaveBeenCalledWith('/api/alerts', {
      params: { area: 'אשקלון', today: 1 },
    });
  });
});

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

describe('fetchStatus', () => {
  test('calls /api/status with no params', async () => {
    await fetchStatus();
    expect(mockGet).toHaveBeenCalledWith('/api/status');
  });
});

describe('fetchPrediction', () => {
  test('calls /api/prediction with the area param', async () => {
    await fetchPrediction('תל אביב');
    expect(mockGet).toHaveBeenCalledWith('/api/prediction', {
      params: { area: 'תל אביב' },
    });
  });

  test('returns prediction data from the response', async () => {
    const prediction = { probability: 0.42, riskLevel: 'moderate' };
    mockGet.mockResolvedValue({ data: prediction });
    const result = await fetchPrediction('אשקלון');
    expect(result).toEqual(prediction);
  });
});
