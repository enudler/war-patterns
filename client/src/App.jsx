import { useEffect, useState, useCallback, useRef } from 'react';
import MapView from './components/Map';
import Sidebar from './components/Sidebar';
import { fetchAreas, fetchSummary, fetchAllAreas, fetchStatus } from './api/client';

const REFRESH_INTERVAL_MS = 30_000;
// v2 key: selectedArea is now area_name_he (Hebrew); old English values are incompatible
const FAVORITE_KEY = 'war_patterns_favorite_area_v2';

// When multiple sub-areas share identical coordinates, spread them in a circle
// so each marker is individually clickable on the map.
function jitterOverlapping(areas) {
  const JITTER_DEG = 0.012; // ~1.3 km — small enough to look local, big enough to click
  const groups = new Map();
  for (const a of areas) {
    const key = `${a.lat},${a.lon}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return areas.map((a) => {
    const siblings = groups.get(`${a.lat},${a.lon}`);
    if (siblings.length === 1) return a;
    const idx = siblings.indexOf(a);
    const angle = (2 * Math.PI * idx) / siblings.length;
    return {
      ...a,
      lat: parseFloat(a.lat) + JITTER_DEG * Math.sin(angle),
      lon: parseFloat(a.lon) + JITTER_DEG * Math.cos(angle),
    };
  });
}

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
  // selectedArea is area_name_he (Hebrew sub-area name) — the unique identifier
  const [selectedArea, setSelectedArea] = useState(null);
  const [favoriteArea, setFavoriteAreaState] = useState(
    () => localStorage.getItem(FAVORITE_KEY) || null
  );
  const [summary, setSummary] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const autoSelected = useRef(false);

  function toggleFavorite(areaNameHe) {
    if (favoriteArea === areaNameHe) {
      localStorage.removeItem(FAVORITE_KEY);
      setFavoriteAreaState(null);
    } else {
      localStorage.setItem(FAVORITE_KEY, areaNameHe);
      setFavoriteAreaState(areaNameHe);
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
        if (nearest) setSelectedArea(nearest.area_name_he);
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

  // Merge static area list (allAreas) with alert counts (alertAreas), keyed by area_name_he.
  // Known areas with no alerts → shown as 0-count circles.
  // oref sub-areas not in areas.json but with alerts → added as extras.
  const alertAreaMap = new Map(alertAreas.map((a) => [a.area_name_he, a]));
  const allAreaSet = new Set(allAreas.map((a) => a.area_name_he));

  const mergedKnown = allAreas.map((a) =>
    alertAreaMap.get(a.area_name_he) ?? { ...a, alert_count: 0, dominant_category: 0, dominant_category_desc: 'No alerts' }
  );
  const extras = alertAreas.filter((a) => !allAreaSet.has(a.area_name_he));
  const mergedAreas = jitterOverlapping([...mergedKnown, ...extras]);

  // Derive English display names for selected and favourite areas
  const areaLabelMap = new Map(mergedAreas.map((a) => [a.area_name_he, a.area_name]));
  const selectedAreaLabel = selectedArea ? (areaLabelMap.get(selectedArea) ?? selectedArea) : null;
  const favoriteAreaLabel = favoriteArea ? (areaLabelMap.get(favoriteArea) ?? favoriteArea) : null;

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
        <MapView areas={mergedAreas} selectedArea={selectedArea} onSelectArea={setSelectedArea} days={days} />
      </div>
      <Sidebar
        selectedArea={selectedArea}
        selectedAreaLabel={selectedAreaLabel}
        favoriteArea={favoriteArea}
        favoriteAreaLabel={favoriteAreaLabel}
        onToggleFavorite={toggleFavorite}
        days={days}
        onDaysChange={setDays}
        summary={summary}
        dataStatus={dataStatus}
      />
    </div>
  );
}
