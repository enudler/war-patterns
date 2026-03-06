import { useEffect, useState } from 'react';
import { fetchStats, fetchAlerts } from '../api/client';
import { DailyBarChart, HourlyBarChart, TypePieChart } from './Charts';
import PredictionGauge from './PredictionGauge';
import LocationSearch from './LocationSearch';

const DAY_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 1,       label: '1d' },
  { value: 2,       label: '2d' },
  { value: 3,       label: '3d' },
  { value: 5,       label: '5d' },
  { value: 7,       label: '7d' },
  { value: 10,      label: '10d' },
  { value: 14,      label: '14d' },
];

const TYPE_BADGE_COLORS = {
  'Rocket / Missile': '#ef4444',
  'UAV / Drone': '#f97316',
};

function badgeColor(desc) {
  return TYPE_BADGE_COLORS[desc] ?? '#3b82f6';
}

function formatTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem',
  });
}

function NotificationSetup() {
  const supported = 'Notification' in window;
  // Read Notification.permission fresh on every render so that a previous grant
  // (from another tab, session, or browser-level approval) is always reflected
  // without relying on stale local state.
  const perm = supported ? Notification.permission : 'unsupported';
  const [, tick] = useState(0);

  async function handleEnable() {
    await Notification.requestPermission();
    tick(n => n + 1); // force re-render to pick up new Notification.permission
  }

  if (!supported || perm === 'granted') return null;

  if (perm === 'denied') {
    return (
      <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>🔕</span>
        <span>Alarm notifications blocked — allow them in browser settings</span>
      </div>
    );
  }

  // perm === 'default'
  return (
    <div style={{
      marginTop: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'rgba(239,68,68,0.08)',
      border: '1px solid rgba(239,68,68,0.2)',
      borderRadius: 6,
      padding: '7px 12px',
      gap: 10,
    }}>
      <span style={{ fontSize: 12, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>🔔</span>
        <span>Get notified when your area is under alarm</span>
      </span>
      <button
        onClick={handleEnable}
        style={{
          background: '#ef4444',
          color: '#fff',
          border: 'none',
          borderRadius: 5,
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Enable
      </button>
    </div>
  );
}

export default function Sidebar({ selectedArea, selectedAreaLabel, favoriteArea, favoriteAreaLabel, onToggleFavorite, onSelectArea, areas, days, onDaysChange, summary, dataStatus }) {
  const availableDays = dataStatus?.oldest
    ? Math.floor((Date.now() - new Date(dataStatus.oldest).getTime()) / 86_400_000)
    : null;
  const isFavorite = selectedArea && selectedArea === favoriteArea;
  const [stats, setStats] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedArea) {
      setStats(null);
      setRecentAlerts([]);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      fetchStats(selectedArea, days),
      fetchAlerts(selectedArea, days),
    ])
      .then(([s, a]) => {
        setStats(s);
        setRecentAlerts(a.slice(0, 20));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedArea, days]);

  const sidebarStyle = {
    width: 360,
    minWidth: 320,
    height: '100%',
    background: '#0f0f1a',
    color: '#e5e5ef',
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'system-ui, sans-serif',
    overflowY: 'auto',
  };

  return (
    <div className="app-sidebar" style={sidebarStyle}>
      {/* Header */}
      <div style={{ padding: '18px 20px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <style>{`
          @keyframes siren-spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes siren-glow  { 0%,100% { box-shadow: 0 0 5px 1px rgba(239,68,68,0.7); } 50% { box-shadow: 0 0 12px 5px rgba(239,68,68,1); } }
        `}</style>
        <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Rotating siren beacon */}
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid #ef4444', position: 'relative', overflow: 'hidden', flexShrink: 0, animation: 'siren-glow 0.9s ease-in-out infinite' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'conic-gradient(from 0deg, #ef4444 0deg 70deg, transparent 70deg 360deg)', animation: 'siren-spin 1.1s linear infinite' }} />
          </div>
          Israel Alert Tracker
        </div>
        <div style={{ marginBottom: 12 }}>
          <LocationSearch areas={areas} onSelectArea={onSelectArea} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', flex: 1, wordBreak: 'break-word' }}>
            {selectedAreaLabel || 'Select a location on the map'}
          </div>
          {selectedArea && (
            <button
              onClick={() => onToggleFavorite(selectedArea)}
              title={isFavorite ? 'Remove default location' : 'Set as default location'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 20,
                lineHeight: 1,
                padding: '2px 4px',
                color: isFavorite ? '#facc15' : '#444',
                transition: 'color 0.15s',
                flexShrink: 0,
              }}
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
        </div>
        {selectedArea && (
          <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
            {isFavorite
              ? '⭐ Default location — loads automatically on startup'
              : favoriteArea
                ? `Default: ${favoriteAreaLabel ?? favoriteArea} · click ☆ to change`
                : 'Click ☆ to set as default location'}
          </div>
        )}
        {selectedArea && stats && (
          <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>
            {stats.total} alert{stats.total !== 1 ? 's' : ''}{' '}
            {days === 'today' ? 'today' : `in ${days} day${days !== 1 ? 's' : ''}`}
          </div>
        )}
        <NotificationSetup />
      </div>

      {/* Time Range Selector */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Time Range
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DAY_OPTIONS.map(({ value, label }) => {
            const isSelected = days === value;
            const isPartial = availableDays !== null
              && value !== 'today'
              && typeof value === 'number'
              && value > availableDays + 1;
            return (
              <button
                key={value}
                onClick={() => onDaysChange(value)}
                title={isPartial ? `Only ~${availableDays}d of data collected so far` : undefined}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1px solid',
                  borderColor: isSelected ? '#ef4444' : isPartial ? 'rgba(234,179,8,0.4)' : 'rgba(255,255,255,0.12)',
                  background: isSelected ? '#ef4444' : 'transparent',
                  color: isSelected ? '#fff' : isPartial ? '#ca8a04' : '#aaa',
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
              >
                {label}
                {isPartial && !isSelected && (
                  <span style={{ marginLeft: 3, fontSize: 9, verticalAlign: 'super', opacity: 0.8 }}>⚠</span>
                )}
              </button>
            );
          })}
        </div>
        {dataStatus?.oldest && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#555' }}>
            Data collected since{' '}
            <span style={{ color: '#777' }}>
              {new Date(dataStatus.oldest).toLocaleString('en-IL', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false,
                timeZone: 'Asia/Jerusalem',
              })}
            </span>
            {availableDays !== null && availableDays < 14 && (
              <span style={{ color: '#444' }}> · grows as server runs</span>
            )}
          </div>
        )}
      </div>

      {/* Global summary (when nothing selected) */}
      {!selectedArea && summary && (
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Overall {days === 'today' ? 'today' : `in ${days}d`} — {summary.total} alerts
          </div>
          {summary.byType.map((t) => (
            <div key={t.category_desc} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: '#ccc' }}>{t.category_desc}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: badgeColor(t.category_desc),
                  background: `${badgeColor(t.category_desc)}22`,
                  padding: '1px 8px',
                  borderRadius: 10,
                }}
              >
                {t.count}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 20, color: '#555', fontSize: 12 }}>
            Click any circle on the map to explore a specific area.
          </div>
        </div>
      )}

      {selectedArea && loading && (
        <div style={{ padding: 20, color: '#888', fontSize: 13 }}>Loading…</div>
      )}

      {selectedArea && error && (
        <div style={{ padding: 20, color: '#ef4444', fontSize: 13 }}>{error}</div>
      )}

      {/* Prediction Gauge — always visible when area selected (independent of stats loading) */}
      {selectedArea && <PredictionGauge area={selectedArea} />}

      {selectedArea && stats && !loading && (
        <>
          {/* Type Breakdown */}
          <div style={{ padding: '16px 20px 8px' }}>
            <SectionTitle>Alert Type Breakdown</SectionTitle>
            <TypePieChart data={stats.byType} />
          </div>

          {/* Daily Timeline */}
          <div style={{ padding: '8px 20px' }}>
            <SectionTitle>Alerts per Day</SectionTitle>
            <DailyBarChart data={stats.byDay} />
          </div>

          {/* Hourly Pattern */}
          <div style={{ padding: '8px 20px' }}>
            <SectionTitle>Time-of-Day Pattern (Israel time)</SectionTitle>
            <HourlyBarChart data={stats.byHour} />
          </div>

          {/* Recent Alerts List */}
          <div style={{ padding: '8px 20px 24px' }}>
            <SectionTitle>Recent Alerts</SectionTitle>
            {recentAlerts.length === 0 ? (
              <p style={{ color: '#555', fontSize: 12 }}>None in this period.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentAlerts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 10px',
                      background: 'rgba(255,255,255,0.04)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: badgeColor(a.category_desc),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, color: '#ccc' }}>{a.category_desc}</span>
                    <span style={{ color: '#666', whiteSpace: 'nowrap' }}>
                      {formatTs(a.alerted_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}
