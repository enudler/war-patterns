import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import MapView from './components/Map';
import Sidebar from './components/Sidebar';
import AlarmOverlay from './components/AlarmOverlay';
import { fetchAreas, fetchSummary, fetchAllAreas, fetchStatus, fetchLiveStatus } from './api/client';

const REFRESH_INTERVAL_MS = 30_000;
const LIVE_POLL_MS = 5_000;
const ALL_CLEAR_DURATION_MS = 8_000;

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function showBrowserNotification(alarm, areaLabel) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`🚨 ${alarm.categoryDesc}`, {
        body: `Active alert in ${areaLabel}`,
        requireInteraction: true,
      });
    } catch {}
  }
}
// v2 key: selectedArea is now area_name_he (Hebrew); old English values are incompatible
const FAVORITE_KEY = 'war_patterns_favorite_area_v2';

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
  const [activeAlarm, setActiveAlarm] = useState(null);
  const [alarmCleared, setAlarmCleared] = useState(false);
  const autoSelected = useRef(false);
  const prevAlarmActive = useRef(false);
  const alarmClearedTimer = useRef(null);
  const selectedAreaLabelRef = useRef(null);
  // Tracks the 3-minute-bucketed alertDate of the currently displayed alarm so
  // that repeated polls for the same active alert don't reset the overlay.
  const activeAlarmBucketRef = useRef(null);

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

  // Request notification permission once on load.
  useEffect(() => { requestNotificationPermission(); }, []);

  // Poll the live oref feed every 5s and trigger the overlay if selected area is under alarm.
  useEffect(() => {
    async function checkLive() {
      try {
        const live = await fetchLiveStatus(selectedArea || undefined);
        const isAlarming = live.active;

        if (isAlarming) {
          // Compute a stable 3-minute bucket ID so repeated polls for the same
          // active alert don't create a new alarm object and reset the overlay.
          const bucket = live.alertDate
            ? String(Math.floor(new Date(live.alertDate.replace(' ', 'T')).getTime() / (3 * 60_000)))
            : 'unknown';

          if (!prevAlarmActive.current) {
            // Alarm just started — show notification and overlay.
            showBrowserNotification(live, selectedAreaLabelRef.current ?? selectedArea);
            setActiveAlarm(live);
            activeAlarmBucketRef.current = bucket;
            prevAlarmActive.current = true;
          } else if (bucket !== activeAlarmBucketRef.current) {
            // Same area, but a genuinely new alarm event (different 3-min bucket).
            showBrowserNotification(live, selectedAreaLabelRef.current ?? selectedArea);
            setActiveAlarm(live);
            activeAlarmBucketRef.current = bucket;
          }
          // else: same alarm still active — don't touch state, overlay stays as-is.
        } else {
          if (prevAlarmActive.current) {
            setAlarmCleared(true);
            clearTimeout(alarmClearedTimer.current);
            alarmClearedTimer.current = setTimeout(
              () => setAlarmCleared(false),
              ALL_CLEAR_DURATION_MS
            );
          }
          setActiveAlarm(null);
          activeAlarmBucketRef.current = null;
          prevAlarmActive.current = false;
        }
      } catch {}
    }

    checkLive();
    const id = setInterval(checkLive, LIVE_POLL_MS);
    return () => {
      clearInterval(id);
      clearTimeout(alarmClearedTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea]);

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
  // Memoized to prevent expensive recalculation on every render.
  const mergedAreas = useMemo(() => {
    const alertAreaMap = new Map(alertAreas.map((a) => [a.area_name_he, a]));
    const allAreaSet = new Set(allAreas.map((a) => a.area_name_he));

    const mergedKnown = allAreas.map((a) =>
      alertAreaMap.get(a.area_name_he) ?? {
        ...a,
        alert_count: 0,
        dominant_category: 0,
        dominant_category_desc: 'No alerts',
      }
    );
    const extras = alertAreas.filter((a) => !allAreaSet.has(a.area_name_he));
    return [...mergedKnown, ...extras];
  }, [allAreas, alertAreas]);

  // Derive English display names for selected and favourite areas
  // Memoized separately since it depends on mergedAreas + selectedArea/favoriteArea
  const { selectedAreaLabel, favoriteAreaLabel } = useMemo(() => {
    const areaLabelMap = new Map(mergedAreas.map((a) => [a.area_name_he, a.area_name]));
    const selectedAreaLabel = selectedArea ? (areaLabelMap.get(selectedArea) ?? selectedArea) : null;
    const favoriteAreaLabel = favoriteArea ? (areaLabelMap.get(favoriteArea) ?? favoriteArea) : null;
    return { selectedAreaLabel, favoriteAreaLabel };
  }, [mergedAreas, selectedArea, favoriteArea]);

  // Keep ref in sync so the live-poll closure always has the latest English label.
  selectedAreaLabelRef.current = selectedAreaLabel;

  return (
    <div className="app-layout" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: '#0f0f1a' }}>
      <AlarmOverlay
        alarm={activeAlarm}
        cleared={alarmCleared}
        monitoredAreaLabel={selectedAreaLabel}
      />
      <div className="app-map-pane" style={{ flex: 1, position: 'relative' }}>
        {error && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 2000, background: '#7f1d1d', color: '#fca5a5',
            padding: '8px 16px', borderRadius: 6, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            maxWidth: '90%', textAlign: 'center',
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
        <a
          href="https://github.com/enudler/war-patterns"
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
          style={{
            position: 'absolute', bottom: 12, right: 12, zIndex: 1000,
            background: 'rgba(15,15,25,0.8)', color: '#aaa',
            padding: '5px 10px', borderRadius: 6, fontSize: 11,
            fontFamily: 'system-ui, sans-serif', backdropFilter: 'blur(4px)',
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <svg height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
              -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87
              2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
              0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21
              2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04
              2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82
              2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0
              1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0
              0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          GitHub
        </a>
      </div>
      <Sidebar
        selectedArea={selectedArea}
        selectedAreaLabel={selectedAreaLabel}
        favoriteArea={favoriteArea}
        favoriteAreaLabel={favoriteAreaLabel}
        onToggleFavorite={toggleFavorite}
        onSelectArea={setSelectedArea}
        areas={mergedAreas}
        days={days}
        onDaysChange={setDays}
        summary={summary}
        dataStatus={dataStatus}
      />
    </div>
  );
}
