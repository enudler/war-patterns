/**
 * DebugPanel — developer overlay to test alarm states and sounds.
 *
 * Toggle with:  Ctrl + Shift + D   (or Cmd + Shift + D on macOS)
 *
 * Lets you fire any alarm variant, trigger the cleared toast and the stand-down
 * chime without waiting for a real oref alert.
 */

const SCENARIOS = [
  {
    id: 'alarm-rocket',
    label: '🚀 Rocket / Missile alarm',
    description: 'Red full-screen overlay + siren',
    alarm: { category: 1, categoryDesc: 'Rocket / Missile', alertDate: null },
    cleared: false,
  },
  {
    id: 'alarm-drone',
    label: '🛸 UAV / Drone alarm',
    description: 'Red full-screen overlay + siren',
    alarm: { category: 2, categoryDesc: 'UAV / Drone', alertDate: null },
    cleared: false,
  },
  {
    id: 'alarm-preAlert10',
    label: '⚠️ Pre-Alert (cat 10)',
    description: 'Amber overlay + soft beep',
    alarm: { category: 10, categoryDesc: 'Pre-Alert', alertDate: null },
    cleared: false,
  },
  {
    id: 'alarm-preAlert',
    label: '⚠️ Pre-Alert / Stand By (cat 14)',
    description: 'Amber overlay + soft beep',
    alarm: { category: 14, categoryDesc: 'Pre-Alert / Stand By', alertDate: null },
    cleared: false,
  },
  {
    id: 'cleared',
    label: '✓ All Clear toast',
    description: 'Green bottom toast, no sound',
    alarm: null,
    cleared: true,
  },
  {
    id: 'standdown',
    label: '🔔 Stand Down chime (cat 13)',
    description: 'Green toast + descending 3-tone chime',
    alarm: null,
    cleared: true,
    playStandDown: true,
  },
  {
    id: 'dismissed-rocket',
    label: '🚀 Rocket alarm (dismissed → banner)',
    description: 'Red slim top banner',
    alarm: { category: 1, categoryDesc: 'Rocket / Missile', alertDate: null },
    cleared: false,
    dismissed: true,
  },
  {
    id: 'dismissed-preAlert',
    label: '⚠️ Pre-Alert / Stand By (dismissed → banner)',
    description: 'Amber slim top banner',
    alarm: { category: 14, categoryDesc: 'Pre-Alert / Stand By', alertDate: null },
    cleared: false,
    dismissed: true,
  },
];

export default function DebugPanel({ onTrigger, onClose }) {
  return (
    <div
      role="dialog"
      aria-label="Debug Panel"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 99999,
        background: '#0f0f1a',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: '16px 20px',
        width: 320,
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        color: '#e5e5ef',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, color: '#666', flex: 1 }}>
          🛠 Debug Panel
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#555',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 4px',
          }}
          title="Close (Ctrl+Shift+D)"
        >
          ✕
        </button>
      </div>

      {/* Scenario buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => onTrigger(s)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#e5e5ef',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
            <span style={{ fontSize: 11, color: '#888' }}>{s.description}</span>
          </button>
        ))}
      </div>

      {/* Reset button */}
      <button
        onClick={() => onTrigger({ id: 'reset', alarm: null, cleared: false })}
        style={{
          marginTop: 12,
          width: '100%',
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 6,
          padding: '7px 0',
          color: '#fca5a5',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.5,
        }}
      >
        Reset / Clear all
      </button>

      <div style={{ marginTop: 10, fontSize: 10, color: '#444', textAlign: 'center' }}>
        Ctrl + Shift + D to toggle
      </div>
    </div>
  );
}
