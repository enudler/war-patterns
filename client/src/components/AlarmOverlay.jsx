import { useState, useEffect, useRef } from 'react';

const CATEGORY_ICON = {
  1:  '🚀',
  2:  '🛸',
  10: '⚠️',
  14: '⚠️',
};

const PHASE_META = {
  preAlert: { icon: '⚠️', label: 'Get Ready' },
  alarm:    { icon: '🚨', label: 'Active Alarm' },
  allClear: { icon: '✓',  label: 'All Clear' },
};

// Cat 10 ("get ready" / pre-alert) uses amber; everything else uses red.
function alarmColors(category) {
  if (category === 10) {
    return {
      overlayBg:  'rgba(146, 64, 14, 0.92)',   // amber-900
      bannerBg:   '#78350f',                    // amber-900 dark
      bannerText: '#fcd34d',                    // amber-300
      bannerBorder: 'rgba(252,211,77,0.5)',
      animation:  'alarm-banner-pulse 1.2s ease-in-out infinite',
    };
  }
  return {
    overlayBg:  'rgba(160, 0, 0, 0.92)',
    bannerBg:   '#7f1d1d',
    bannerText: '#fca5a5',
    bannerBorder: 'rgba(252,165,165,0.5)',
    animation:  'alarm-banner-pulse 1.2s ease-in-out infinite',
  };
}

function fmt(date) {
  if (!date) return '';
  return date instanceof Date
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
}

// Renders the incident timeline as a column of phase rows.
function IncidentTimeline({ entries, style = {} }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      marginTop: 16,
      padding: '10px 16px',
      background: 'rgba(0,0,0,0.25)',
      borderRadius: 6,
      minWidth: 220,
      ...style,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.55, marginBottom: 4 }}>
        Incident Timeline
      </div>
      {entries.map((entry, i) => {
        const meta = PHASE_META[entry.phase] ?? { icon: '•', label: entry.phase };
        const isLast = i === entries.length - 1;
        return (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            opacity: isLast ? 1 : 0.65,
            fontWeight: isLast ? 600 : 400,
          }}>
            <span style={{ width: 18, textAlign: 'center' }}>{meta.icon}</span>
            <span style={{ flex: 1 }}>{meta.label}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmt(entry.time)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Compact inline timeline for the slim banner.
function InlineTimeline({ entries }) {
  if (!entries || entries.length === 0) return null;
  return (
    <span style={{ opacity: 0.65, fontSize: 11, fontFamily: 'monospace' }}>
      {entries.map((e, i) => {
        const meta = PHASE_META[e.phase] ?? { icon: '•' };
        return (
          <span key={i}>
            {i > 0 && <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>}
            {meta.icon} {fmt(e.time)}
          </span>
        );
      })}
    </span>
  );
}

function CategoryIcon({ category }) {
  return <span style={{ fontSize: 64, display: 'block', marginBottom: 8 }}>{CATEGORY_ICON[category] ?? '🚨'}</span>;
}

export default function AlarmOverlay({ alarm, cleared, monitoredAreaLabel, onDismiss, forceDismissed = false, timeline = [] }) {
  const [dismissed, setDismissed] = useState(false);
  const lastAlertDate = useRef(null);

  // Re-show overlay if a new alarm fires (different alertDate)
  useEffect(() => {
    if (alarm && alarm.alertDate !== lastAlertDate.current) {
      lastAlertDate.current = alarm.alertDate;
      setDismissed(false);
    }
  }, [alarm]);

  // Reset dismiss when alarm clears
  useEffect(() => {
    if (!alarm) setDismissed(false);
  }, [alarm]);

  if (!alarm && !cleared) return null;

  // forceDismissed lets the debug panel jump straight to the slim-banner state.
  const isDismissed = dismissed || forceDismissed;

  if (alarm && !isDismissed) {
    const colors = alarmColors(alarm.category);
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: colors.overlayBg,
          backdropFilter: 'blur(4px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#fff',
          animation: 'alarm-pulse 1.2s ease-in-out infinite',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <CategoryIcon category={alarm.category} />
        <div style={{ fontSize: 13, letterSpacing: 4, textTransform: 'uppercase', opacity: 0.8, marginBottom: 4 }}>
          {alarm.category === 10 ? 'Stand By — Get Ready' : 'Active Alarm'}
        </div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 36, fontWeight: 700, letterSpacing: 1 }}>
          {alarm.categoryDesc}
        </h1>
        <div style={{ fontSize: 20, opacity: 0.9, marginBottom: 4 }}>
          {monitoredAreaLabel}
        </div>
        <IncidentTimeline entries={timeline} />
        <button
          onClick={() => { setDismissed(true); onDismiss?.(); }}
          style={{
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 6,
            padding: '8px 24px',
            fontSize: 14,
            cursor: 'pointer',
            letterSpacing: 1,
            marginTop: 20,
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (alarm && isDismissed) {
    const colors = alarmColors(alarm.category);
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: colors.bannerBg,
          color: colors.bannerText,
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          animation: colors.animation,
          flexWrap: 'wrap',
        }}
      >
        <span>{CATEGORY_ICON[alarm.category] ?? '🚨'}</span>
        <span>
          <strong>{alarm.category === 10 ? 'STAND BY' : 'ACTIVE ALARM'}</strong>{' '}
          — {alarm.categoryDesc} in {monitoredAreaLabel}
        </span>
        <InlineTimeline entries={timeline} />
        <button
          onClick={() => setDismissed(false)}
          style={{
            background: 'none',
            border: `1px solid ${colors.bannerBorder}`,
            color: colors.bannerText,
            borderRadius: 4,
            padding: '2px 10px',
            fontSize: 12,
            cursor: 'pointer',
            marginLeft: 8,
          }}
        >
          Show
        </button>
      </div>
    );
  }

  if (cleared) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: '#064e3b',
          color: '#6ee7b7',
          border: '1px solid #065f46',
          padding: '14px 28px',
          borderRadius: 8,
          fontSize: 16,
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          minWidth: 220,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>✓</span>
          <span>All Clear — {monitoredAreaLabel}</span>
        </div>
        {timeline.length > 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            width: '100%',
            borderTop: '1px solid rgba(110,231,183,0.2)',
            paddingTop: 6,
          }}>
            {timeline.map((entry, i) => {
              const meta = PHASE_META[entry.phase] ?? { icon: '•', label: entry.phase };
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.8, gap: 16 }}>
                  <span>{meta.icon} {meta.label}</span>
                  <span style={{ fontFamily: 'monospace' }}>{fmt(entry.time)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return null;
}
