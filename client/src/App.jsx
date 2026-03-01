import { useEffect, useState, useCallback, useRef } from 'react';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import { fetchAreas, fetchSummary, fetchAllAreas, fetchStatus } from './api/client';

const REFRESH_INTERVAL_MS = 30_000;
const FAVORITE_KEY = 'war_patterns_favorite_area';

function findNearest(lat, lon, areas) {
  let nearest = null;
  let minDist = Infinity;
  for (const area of areas) {
    if (!area.lat || !area.lon) continue;
    const dlat = parseFloat(area.lat) - lat;
    const dlon = parseFloat(area.lon) - lon;
    const dist = dlat * dlat + dlon * dlon;
    if (dist < minDist) { minDist = dist; nearest = area; }
  }
  return nearest;
}

export default function App() {
  const [days, setDays] = useState(7);
  const [allAreas, setAllAreas] = useState([]);
  const [alertAreas, setAlertAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [favoriteArea, setFavoriteAreaState] = useState(
    () => localStorage.getItem(FAVORITE_KEY) || null
  );
  const [summary, setSummary] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const autoSelected = useRef(false);

  function toggleFavorite(areaName) {
    if (favoriteArea === areaName) {
      localStorage.removeItem(FAVORITE_KEY);
      setFavoriteAreaState(null);
    } else {
      localStorage.setItem(FAVORITE_KEY, areaName);
      setFavoriteAreaState(areaName);
    }
  }

  // Load static areas + status once
  useEffect(() => {
    fetchAllAreas().then(setAllAreas).catch(() => {});
    fetchStatus().then(setDataStatus).catch(() => {});
  }, []);

  // Auto-select on startup: favorite first, then geolocation nearest
  useEffect(() => {
    if (allAreas.length === 0 || autoSelected.current) return;
    autoSelected.current = true;

    const saved = localStorage.getItem(FAVORITE_KEY);
    if (saved) {
      setSelectedArea(saved);
      return;
    }

    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nearest = findNearest(pos.coords.latitude, pos.coords.longitude, allAreas);
        if (nearest) setSelectedArea(nearest.area_name);
      },
      () => {}, // fail silently — user just won't get auto-selection
      { timeout: 6000, maximumAge: 300_000 }
    );
  }, [allAreas]);

  const loadAlerts = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([fetchAreas(days), fetchSummary(days)]);
      setAlertAreas(a);
      setSummary(s);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError('Could not reach server. Is it running?');
    }
  }, [days]);

  useEffect(() => {
    loadAlerts();
    const id = setInterval(loadAlerts, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadAlerts]);

  const mergedAreas = allAreas.map((a) => {
    const hit = alertAreas.find((x) => x.area_name === a.area_name);
    return hit
      ? hit
      : { ...a, alert_count: 0, dominant_category: 0, dominant_category_desc: 'No alerts' };
  });

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: '#0f0f1a' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        {error && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 2000, background: '#7f1d1d', color: '#fca5a5',
            padding: '8px 20px', borderRadius: 6, fontSize: 13, fontFamily: 'system-ui, sans-serif',
          }}>
            {error}
          </div>
        )}
        {lastUpdated && (
          <div style={{
            position: 'absolute', top: 12, right: 12, zIndex: 1000,
            background: 'rgba(15,15,25,0.8)', color: '#666',
            padding: '4px 12px', borderRadius: 6, fontSize: 11,
            fontFamily: 'system-ui, sans-serif', backdropFilter: 'blur(4px)',
          }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </div>
        )}
        <Map areas={mergedAreas} selectedArea={selectedArea} onSelectArea={setSelectedArea} days={days} />
      </div>
      <Sidebar
        selectedArea={selectedArea}
        favoriteArea={favoriteArea}
        onToggleFavorite={toggleFavorite}
        days={days}
        onDaysChange={setDays}
        summary={summary}
        dataStatus={dataStatus}
      />
    </div>
  );
}
