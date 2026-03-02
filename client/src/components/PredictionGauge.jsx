import { useEffect, useState } from 'react';
import { fetchPrediction } from '../api/client';

const RISK_CONFIG = {
  none:      { label: 'No Data',   color: '#374151' },
  very_low:  { label: 'Very Low',  color: '#22c55e' },
  low:       { label: 'Low',       color: '#84cc16' },
  moderate:  { label: 'Moderate',  color: '#eab308' },
  high:      { label: 'High',      color: '#f97316' },
  very_high: { label: 'Very High', color: '#ef4444' },
  critical:  { label: 'Critical',  color: '#dc2626' },
};

const FACTOR_LABELS = {
  baseRate:      { name: 'Base Rate',      desc: 'Historical alert frequency' },
  hourlyFactor:  { name: 'Hour Pattern',   desc: 'Current hour vs average' },
  trendFactor:   { name: '24h Trend',      desc: 'Recent rate vs overall' },
  momentumScore: { name: 'Momentum',       desc: 'Time since last alert' },
  dowFactor:     { name: 'Day of Week',    desc: 'Current weekday pattern' },
};

function factorBar(value, key) {
  // Normalize factor to 0–1 range for display
  // baseRate & momentumScore are already 0–1
  // hourlyFactor, trendFactor, dowFactor are ratios around 1.0
  if (key === 'baseRate' || key === 'momentumScore') return Math.min(value, 1);
  // For ratio-based factors: 0→0, 1→0.5, 2+→1
  return Math.min(value / 2, 1);
}

function factorColor(value, key) {
  const norm = factorBar(value, key);
  if (norm < 0.25) return '#22c55e';
  if (norm < 0.5)  return '#eab308';
  if (norm < 0.75) return '#f97316';
  return '#ef4444';
}

// SVG semi-circular gauge
function Gauge({ probability, riskLevel }) {
  const cfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.none;
  const pct = Math.round(probability * 100);

  // Arc geometry
  const cx = 100, cy = 90;
  const r = 72;
  const strokeWidth = 12;

  // Start at 180° (left), end at 0° (right) — semi-circle
  const startAngle = Math.PI;
  const sweepAngle = Math.PI * Math.min(probability, 1);

  // Background arc (full semi-circle)
  const bgX1 = cx + r * Math.cos(Math.PI);
  const bgY1 = cy - r * Math.sin(Math.PI);
  const bgX2 = cx + r * Math.cos(0);
  const bgY2 = cy - r * Math.sin(0);

  // Foreground arc endpoint
  const fgAngle = startAngle - sweepAngle;
  const fgX = cx + r * Math.cos(fgAngle);
  const fgY = cy - r * Math.sin(fgAngle);
  const largeArc = probability > 0.5 ? 1 : 0;

  // Gradient stops for the arc
  const gradientId = 'gaugeGrad';

  return (
    <svg viewBox="0 0 200 110" width="100%" style={{ maxWidth: 220, display: 'block', margin: '0 auto' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="35%" stopColor="#eab308" />
          <stop offset="65%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>

      {/* Background arc */}
      <path
        d={`M ${bgX1} ${bgY1} A ${r} ${r} 0 0 1 ${bgX2} ${bgY2}`}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* Foreground arc */}
      {probability > 0.001 && (
        <path
          d={`M ${bgX1} ${bgY1} A ${r} ${r} 0 ${largeArc} 1 ${fgX} ${fgY}`}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}

      {/* Percentage text */}
      <text x={cx} y={cy - 10} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="700"
        fontFamily="system-ui, sans-serif">
        {pct}%
      </text>

      {/* Risk label */}
      <text x={cx} y={cy + 12} textAnchor="middle" fill={cfg.color} fontSize="12" fontWeight="600"
        fontFamily="system-ui, sans-serif" textTransform="uppercase" letterSpacing="1">
        {cfg.label}
      </text>

      {/* Scale labels */}
      <text x={28 - 8} y={cy + 8} fill="#555" fontSize="9" fontFamily="system-ui, sans-serif">0%</text>
      <text x={200 - 28 - 6} y={cy + 8} fill="#555" fontSize="9" fontFamily="system-ui, sans-serif">100%</text>
    </svg>
  );
}

export default function PredictionGauge({ area }) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!area) { setPrediction(null); return; }
    setLoading(true);
    setError(null);
    fetchPrediction(area)
      .then(setPrediction)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    // Refresh prediction every 60 seconds
    const id = setInterval(() => {
      fetchPrediction(area).then(setPrediction).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [area]);

  if (!area) return null;
  if (loading && !prediction) {
    return <div style={{ padding: '12px 0', color: '#555', fontSize: 12, textAlign: 'center' }}>Calculating…</div>;
  }
  if (error && !prediction) return null; // silently skip on error

  if (!prediction) return null;

  const { probability, riskLevel, factors, meta } = prediction;
  const cfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.none;

  return (
    <div style={{ padding: '16px 20px 8px' }}>
      <div style={{
        fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
      }}>
        Next-Hour Attack Probability
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 12,
        padding: '16px 12px 12px',
        border: `1px solid ${cfg.color}22`,
      }}>
        <Gauge probability={probability} riskLevel={riskLevel} />

        {/* Factor breakdown */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(factors).map(([key, value]) => {
            const info = FACTOR_LABELS[key];
            if (!info) return null;
            const norm = factorBar(value, key);
            const color = factorColor(value, key);
            return (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: '#aaa' }}>{info.name}</span>
                  <span style={{ fontSize: 11, color: '#666' }}>
                    {key === 'baseRate' || key === 'momentumScore'
                      ? `${(value * 100).toFixed(1)}%`
                      : `${value.toFixed(2)}x`}
                  </span>
                </div>
                <div style={{
                  height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${Math.max(norm * 100, 1)}%`, borderRadius: 2,
                    background: color, transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Meta info */}
        <div style={{
          marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 10, color: '#555',
        }}>
          {meta.alertsLast24h != null && (
            <span>{meta.alertsLast24h} alerts in 24h</span>
          )}
          {meta.hoursSinceLastAlert != null && (
            <span>Last alert {meta.hoursSinceLastAlert < 1
              ? `${Math.round(meta.hoursSinceLastAlert * 60)}m ago`
              : `${meta.hoursSinceLastAlert.toFixed(1)}h ago`}
            </span>
          )}
          {meta.totalAlerts > 0 && (
            <span>{meta.totalAlerts} total in {meta.observationHours.toFixed(0)}h window</span>
          )}
        </div>
      </div>
    </div>
  );
}
