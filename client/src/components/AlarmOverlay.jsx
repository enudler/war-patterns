import { useState, useEffect, useRef } from 'react';

const CATEGORY_ICON = {
  1: '🚀',
  2: '🛸',
};

function CategoryIcon({ category }) {
  return <span style={{ fontSize: 64, display: 'block', marginBottom: 8 }}>{CATEGORY_ICON[category] ?? '🚨'}</span>;
}

export default function AlarmOverlay({ alarm, cleared, monitoredAreaLabel }) {
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

  if (alarm && !dismissed) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(160, 0, 0, 0.92)',
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
          Active Alarm
        </div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 36, fontWeight: 700, letterSpacing: 1 }}>
          {alarm.categoryDesc}
        </h1>
        <div style={{ fontSize: 20, opacity: 0.9, marginBottom: 4 }}>
          {monitoredAreaLabel}
        </div>
        <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 32 }}>
          {alarm.alertDate ? new Date(alarm.alertDate.replace(' ', 'T')).toLocaleTimeString() : ''}
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 6,
            padding: '8px 24px',
            fontSize: 14,
            cursor: 'pointer',
            letterSpacing: 1,
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (alarm && dismissed) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: '#7f1d1d',
          color: '#fca5a5',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          animation: 'alarm-banner-pulse 1.2s ease-in-out infinite',
        }}
      >
        <span>{CATEGORY_ICON[alarm.category] ?? '🚨'}</span>
        <span>
          <strong>ACTIVE ALARM</strong> — {alarm.categoryDesc} in {monitoredAreaLabel}
        </span>
        <button
          onClick={() => setDismissed(false)}
          style={{
            background: 'none',
            border: '1px solid rgba(252,165,165,0.5)',
            color: '#fca5a5',
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
          padding: '12px 28px',
          borderRadius: 8,
          fontSize: 16,
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 20 }}>✓</span>
        <span>All Clear — {monitoredAreaLabel}</span>
      </div>
    );
  }

  return null;
}
