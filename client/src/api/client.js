import axios from 'axios';

// Empty string → relative paths (same origin, used in Docker).
// Undefined (dev without .env) → default to localhost.
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const api = axios.create({ baseURL: BASE });

function timeParams(period) {
  return period === 'today' ? { today: 1 } : { days: period };
}

export async function fetchAreas(period) {
  const { data } = await api.get('/api/areas', { params: timeParams(period) });
  return data;
}

export async function fetchStats(area, period) {
  const { data } = await api.get('/api/stats', { params: { area, ...timeParams(period) } });
  return data;
}

export async function fetchAlerts(area, period) {
  const { data } = await api.get('/api/alerts', { params: { area, ...timeParams(period) } });
  return data;
}

export async function fetchSummary(period) {
  const { data } = await api.get('/api/summary', { params: timeParams(period) });
  return data;
}

export async function fetchAllAreas() {
  const { data } = await api.get('/api/areas/all');
  return data;
}

export async function fetchStatus() {
  const { data } = await api.get('/api/status');
  return data;
}
