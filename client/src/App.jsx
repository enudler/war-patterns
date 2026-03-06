import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import MapView from './components/Map';
import Sidebar from './components/Sidebar';
import AlarmOverlay from './components/AlarmOverlay';
import DebugPanel from './components/DebugPanel';
import { fetchAreas, fetchSummary, fetchAllAreas, fetchStatus, fetchLiveStatus } from './api/client';

const REFRESH_INTERVAL_MS = 30_000;
const LIVE_POLL_MS = 5_000;
const ALL_CLEAR_DURATION_MS = 8_000;
const TIMELINE_RESET_MS = 20 * 60 * 1_000; // 20 min — reset timeline if no new alarm

// Synthesise a repeating air-raid siren using the Web Audio API.
// Returns { stop() } or null when the API is unavailable.
// The siren sweeps from ~330 Hz to ~990 Hz and back, cycling every 2.5 s.
function createAlarmSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = 660;   // centre frequency

    lfo.type = 'sine';
    lfo.frequency.value = 0.4;   // one sweep every 2.5 s
    lfoGain.gain.value = 330;    // ±330 Hz → sweeps 330–990 Hz

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.25;

    // resume() is required by browser autoplay policy
    ctx.resume().then(() => { lfo.start(); osc.start(); }).catch(() => {});

    return {
      stop() {
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
          setTimeout(() => ctx.close().catch(() => {}), 400);
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

// Gentle descending 3-tone chime for "danger passed" (cat 10 / cat 13).
// One-shot — no stop() needed.
function createStandDownSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    gain.gain.value = 0.18;
    gain.connect(ctx.destination);
    ctx.resume().then(() => {
      [880, 660, 440].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ctx.currentTime + i * 0.38);
        osc.stop(ctx.currentTime + i * 0.38 + 0.30);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1800);
    }).catch(() => {});
  } catch {}
}

// Soft repeating beep for category-14 "get ready / pre-alert".
// Returns { stop() } or null when the API is unavailable.
function createPreAlertSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 520;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Schedule 60 short beeps: 0.18 s on, 1.2 s off (covers ~1 min)
    ctx.resume().then(() => {
      osc.start();
      for (let i = 0; i < 60; i++) {
        const t = ctx.currentTime + i * 1.38;
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.setValueAtTime(0,    t + 0.18);
      }
    }).catch(() => {});
    return {
      stop() {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.setValueAtTime(0, ctx.currentTime);
          setTimeout(() => ctx.close().catch(() => {}), 200);
        } catch {}
      },
    };
  } catch {
    return null;
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
  // Timeline for the current incident: [{phase, time, alarm}]
  // phase: 'preAlert' | 'alarm' | 'allClear'
  const [alarmTimeline, setAlarmTimeline] = useState([]);
  const autoSelected = useRef(false);
  const prevAlarmActive = useRef(false);
  const prevAlarmCategoryRef = useRef(null); // category of the currently active alarm
  const alarmClearedTimer = useRef(null);
  const selectedAreaLabelRef = useRef(null);
  // Tracks the 3-minute-bucketed alertDate of the currently displayed alarm so
  // that repeated polls for the same active alert don't reset the overlay.
  const activeAlarmBucketRef = useRef(null);
  const lastPreAlertBucketRef = useRef(null); // tracks last cat-10/13 stand-down shown
  const alarmSoundRef = useRef(null); // currently playing siren instance
  const timelineResetTimerRef = useRef(null); // 20-min idle timer to clear timeline

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

  // Poll the live oref feed every 5s and trigger the overlay if selected area is under alarm.
  useEffect(() => {
    async function checkLive() {
      try {
        // Without a selected area we're in the global view — don't trigger the
        // siren/overlay, which would cause a false alarm on every page load while
        // auto-select (localStorage / geolocation) hasn't resolved yet.
        if (!selectedArea) return;

        const live = await fetchLiveStatus(selectedArea);
        const isAlarming = live.active;

        if (isAlarming) {
          // Compute a stable 3-minute bucket ID so repeated polls for the same
          // active alert don't create a new alarm object and reset the overlay.
          const bucket = live.alertDate
            ? String(Math.floor(new Date(live.alertDate.replace(' ', 'T')).getTime() / (3 * 60_000)))
            : 'unknown';

          // Cat 14 = "get ready / stand by" → soft beep; all others → full siren.
          const startSound = () =>
            live.category === 14 ? createPreAlertSound() : createAlarmSound();

          if (!prevAlarmActive.current) {
            // Alarm just started — show notification, overlay and sound.
            clearTimeout(timelineResetTimerRef.current); // cancel any pending idle reset
            showBrowserNotification(live, selectedAreaLabelRef.current ?? selectedArea);
            setActiveAlarm(live);
            activeAlarmBucketRef.current = bucket;
            prevAlarmActive.current = true;
            prevAlarmCategoryRef.current = live.category;
            alarmSoundRef.current = startSound();
            // Start a fresh timeline for this new incident.
            const phase = live.category === 14 ? 'preAlert' : 'alarm';
            setAlarmTimeline([{ phase, time: new Date(), alarm: live }]);
          } else if (bucket !== activeAlarmBucketRef.current) {
            // Same area, but a genuinely new alarm event (different 3-min bucket).
            showBrowserNotification(live, selectedAreaLabelRef.current ?? selectedArea);
            clearTimeout(timelineResetTimerRef.current); // cancel any pending idle reset
            const prevCat = prevAlarmCategoryRef.current;
            const newCat  = live.category;
            setActiveAlarm(live);
            activeAlarmBucketRef.current = bucket;
            prevAlarmCategoryRef.current = newCat;
            // Restart sound for the new event.
            alarmSoundRef.current?.stop();
            alarmSoundRef.current = startSound();
            if (prevCat === 14 && (newCat === 1 || newCat === 2)) {
              // Upgrade: "get ready" → actual alarm — append to current timeline.
              setAlarmTimeline(prev => [...prev, { phase: 'alarm', time: new Date(), alarm: live }]);
            } else {
              // New or unrelated incident — reset timeline.
              const phase = newCat === 14 ? 'preAlert' : 'alarm';
              setAlarmTimeline([{ phase, time: new Date(), alarm: live }]);
            }
          }
          // else: same alarm still active — don't touch state, overlay stays as-is.
        } else {
          if (prevAlarmActive.current) {
            alarmSoundRef.current?.stop();
            alarmSoundRef.current = null;
            if (live.preAlert) createStandDownSound();
            setAlarmCleared(true);
            clearTimeout(alarmClearedTimer.current);
            alarmClearedTimer.current = setTimeout(
              () => setAlarmCleared(false),
              ALL_CLEAR_DURATION_MS
            );
            // Append all-clear to the incident timeline, then auto-reset after 20 min.
            setAlarmTimeline(prev => [...prev, { phase: 'allClear', time: new Date() }]);
            clearTimeout(timelineResetTimerRef.current);
            timelineResetTimerRef.current = setTimeout(() => setAlarmTimeline([]), TIMELINE_RESET_MS);
          } else if (live.preAlert) {
            // Cat 10/13 arrived without us ever seeing the active alarm this session
            // (page opened mid-event, or area changed after cat 1/2 ended).
            // Use the same 3-min bucket dedup so we don't re-fire on every poll.
            const preAlertBucket = live.alertDate
              ? String(Math.floor(new Date(live.alertDate.replace(' ', 'T')).getTime() / (3 * 60_000)))
              : 'unknown';
            if (preAlertBucket !== lastPreAlertBucketRef.current) {
              lastPreAlertBucketRef.current = preAlertBucket;
              createStandDownSound();
              setAlarmCleared(true);
              clearTimeout(alarmClearedTimer.current);
              alarmClearedTimer.current = setTimeout(
                () => setAlarmCleared(false),
                ALL_CLEAR_DURATION_MS
              );
              // All clear without a prior alarm in this session.
              setAlarmTimeline(prev => [...prev, { phase: 'allClear', time: new Date() }]);
              clearTimeout(timelineResetTimerRef.current);
              timelineResetTimerRef.current = setTimeout(() => setAlarmTimeline([]), TIMELINE_RESET_MS);
            }
          }
          setActiveAlarm(null);
          activeAlarmBucketRef.current = null;
          prevAlarmActive.current = false;
          prevAlarmCategoryRef.current = null;
        }
      } catch {}
    }

    checkLive();
    const id = setInterval(checkLive, LIVE_POLL_MS);
    return () => {
      clearInterval(id);
      clearTimeout(alarmClearedTimer.current);
      alarmSoundRef.current?.stop();
      alarmSoundRef.current = null;
      // Reset alarm tracking refs so the next effect run (e.g. after selectedArea
      // changes) starts clean and doesn't trigger a false "all clear" event.
      prevAlarmActive.current = false;
      activeAlarmBucketRef.current = null;
      lastPreAlertBucketRef.current = null;
      prevAlarmCategoryRef.current = null;
      clearTimeout(timelineResetTimerRef.current);
      setAlarmTimeline([]);
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

  // ── Debug panel (Ctrl/Cmd + Shift + D) ──────────────────────────────────────
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugAlarm, setDebugAlarm]   = useState(null);
  const [debugCleared, setDebugCleared] = useState(false);
  const debugSoundRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleDebugTrigger(scenario) {
    // Stop any previously playing debug sound
    debugSoundRef.current?.stop();
    debugSoundRef.current = null;

    if (scenario.id === 'reset') {
      setDebugAlarm(null);
      setDebugCleared(false);
      return;
    }

    // Build a fresh alarm object with a unique alertDate so AlarmOverlay resets
    const alarm = scenario.alarm
      ? { ...scenario.alarm, alertDate: new Date().toISOString(), _debug: true }
      : null;

    if (scenario.dismissed) {
      // Show in "dismissed → slim banner" state by setting a dismissed-at marker
      setDebugAlarm({ ...alarm, _dismissed: true });
      setDebugCleared(false);
      if (alarm?.category === 14) debugSoundRef.current = createPreAlertSound();
      else if (alarm)             debugSoundRef.current = createAlarmSound();
    } else if (alarm) {
      setDebugAlarm(alarm);
      setDebugCleared(false);
      if (alarm.category === 14) debugSoundRef.current = createPreAlertSound();
      else                       debugSoundRef.current = createAlarmSound();
    } else {
      setDebugAlarm(null);
      setDebugCleared(scenario.cleared ?? false);
      if (scenario.playStandDown) createStandDownSound();
    }

    // Auto-clear after 8 s for toast scenarios
    if (!alarm && scenario.cleared) {
      setTimeout(() => setDebugCleared(false), ALL_CLEAR_DURATION_MS);
    }
  }

  // Decide what the overlay should show:
  // Real alarms take priority; debug overrides when there's no real alarm.
  const overlayAlarm   = activeAlarm ?? debugAlarm;
  const overlayCleared = alarmCleared || debugCleared;
  // For dismissed-banner debug: AlarmOverlay tracks dismissed state internally,
  // so we pass _dismissed hint via the alarm object and use an AlarmOverlayDebug
  // wrapper that forces dismissed=true when the flag is present.

  return (
    <div className="app-layout" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: '#0f0f1a' }}>
      <AlarmOverlay
        alarm={overlayAlarm}
        cleared={overlayCleared}
        monitoredAreaLabel={selectedAreaLabel ?? 'Test Area'}
        forceDismissed={overlayAlarm?._dismissed ?? false}
        timeline={alarmTimeline}
        onDismiss={() => {
          alarmSoundRef.current?.stop(); alarmSoundRef.current = null;
          debugSoundRef.current?.stop(); debugSoundRef.current = null;
        }}
      />
      {debugOpen && (
        <DebugPanel
          onTrigger={handleDebugTrigger}
          onClose={() => setDebugOpen(false)}
        />
      )}
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
