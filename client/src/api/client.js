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
  const { data } = await api.get(`/api/areas/${encodeURIComponent(area)}/stats`, { params: timeParams(period) });
  return data;
}

export async function fetchAlerts(area, period) {
  const { data } = await api.get(`/api/areas/${encodeURIComponent(area)}/alerts`, { params: timeParams(period) });
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

export async function fetchPrediction(area) {
  const { data } = await api.get(`/api/areas/${encodeURIComponent(area)}/prediction`);
  return data;
}

export async function fetchPredictionTimeline(area, hours = 12) {
  const { data } = await api.get(
    `/api/areas/${encodeURIComponent(area)}/prediction/timeline`,
    { params: { hours } }
  );
  return data;
}

// Returns current active alert state directly from the oref live feed (no DB, no delay).
// Without area: { active: false, areas: [] } or { active: true, areas, category, categoryDesc, alertDate }
// With area:    { active: false } or { active: true, category, categoryDesc, alertDate }
export async function fetchLiveStatus(area) {
  const params = area ? { area } : {};
  const { data } = await api.get('/api/live', { params });
  return data;
}
