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
  baseRate:      'Base Rate',
  hourlyFactor:  'Hour Pattern',
  trendFactor:   '24h Trend',
  momentumScore: 'Momentum',
  dowFactor:     'Day of Week',
};

function factorNorm(value, key) {
  if (key === 'baseRate' || key === 'momentumScore') return Math.min(value, 1);
  return Math.min(value / 2, 1);
}

function factorColor(norm) {
  if (norm < 0.25) return '#22c55e';
  if (norm < 0.5)  return '#eab308';
  if (norm < 0.75) return '#f97316';
  return '#ef4444';
}

/* ── Gauge — clean arc with discrete colour segments ────────────────── */
function Gauge({ probability, riskLevel }) {
  const cfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.none;
  const pct = Math.round(probability * 100);

  const cx = 120, cy = 100;
  const r = 80;
  const sw = 10; // stroke width

  /* Semi-circle: π → 0  (left to right) */
  const arcPath = (startPct, endPct) => {
    const a1 = Math.PI * (1 - startPct);
    const a2 = Math.PI * (1 - endPct);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy - r * Math.sin(a2);
    const large = (endPct - startPct) > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  /* Discrete segments: green → yellow → orange → red */
  const segments = [
    { from: 0,    to: 0.25, color: '#22c55e' },
    { from: 0.25, to: 0.50, color: '#eab308' },
    { from: 0.50, to: 0.75, color: '#f97316' },
    { from: 0.75, to: 1.00, color: '#ef4444' },
  ];

  /* Needle angle */
  const needleAngle = Math.PI * (1 - Math.min(probability, 1));
  const needleLen = r - 20;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy - needleLen * Math.sin(needleAngle);

  return (
    <svg viewBox="0 0 240 130" width="100%" style={{ maxWidth: 240, display: 'block', margin: '0 auto' }}>
      {/* Background track */}
      <path
        d={arcPath(0, 1)}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={sw + 4}
        strokeLinecap="round"
      />

      {/* Coloured segments (dimmed for unlit portion, bright for lit) */}
      {segments.map((seg, i) => {
        const segEnd = Math.min(probability, seg.to);
        if (segEnd <= seg.from) {
          // Not reached — dim
          return (
            <path key={i} d={arcPath(seg.from, seg.to)} fill="none"
              stroke={seg.color} strokeWidth={sw} strokeLinecap="butt"
              opacity={0.12}
            />
          );
        }
        // Partially or fully lit
        const litEnd = Math.min(probability, seg.to);
        return (
          <g key={i}>
            {/* Dim remainder if partially lit */}
            {litEnd < seg.to && (
              <path d={arcPath(litEnd, seg.to)} fill="none"
                stroke={seg.color} strokeWidth={sw} strokeLinecap="butt"
                opacity={0.12}
              />
            )}
            {/* Bright lit portion */}
            <path d={arcPath(seg.from, litEnd)} fill="none"
              stroke={seg.color} strokeWidth={sw} strokeLinecap="butt"
              opacity={0.9}
            />
          </g>
        );
      })}

      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny}
        stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.85}
      />
      <circle cx={cx} cy={cy} r={4} fill="#fff" opacity={0.7} />

      {/* Percentage text */}
      <text x={cx} y={cy - 22} textAnchor="middle" fill="#fff" fontSize="32" fontWeight="700"
        fontFamily="system-ui, sans-serif">
        {pct}%
      </text>

      {/* Risk label */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill={cfg.color} fontSize="13" fontWeight="600"
        fontFamily="system-ui, sans-serif">
        {cfg.label}
      </text>

      {/* Scale labels */}
      <text x={32} y={cy + 16} fill="#555" fontSize="9" textAnchor="middle"
        fontFamily="system-ui, sans-serif">0%</text>
      <text x={208} y={cy + 16} fill="#555" fontSize="9" textAnchor="middle"
        fontFamily="system-ui, sans-serif">100%</text>
    </svg>
  );
}

/* ── Factor Row ─────────────────────────────────────────────────────── */
function FactorRow({ name, value, factorKey }) {
  const norm = factorNorm(value, factorKey);
  const color = factorColor(norm);
  const display = (factorKey === 'baseRate' || factorKey === 'momentumScore')
    ? `${(value * 100).toFixed(1)}%`
    : `${value.toFixed(2)}x`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, color: '#777', width: 80, flexShrink: 0 }}>{name}</span>
      <div style={{
        flex: 1, height: 3, borderRadius: 2,
        background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.max(norm * 100, 2)}%`,
          borderRadius: 2,
          background: color,
          opacity: 0.7,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, color: '#555', width: 44, textAlign: 'right', flexShrink: 0 }}>
        {display}
      </span>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────── */
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

    const id = setInterval(() => {
      fetchPrediction(area).then(setPrediction).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [area]);

  if (!area) return null;
  if (loading && !prediction) {
    return <div style={{ padding: '12px 0', color: '#555', fontSize: 12, textAlign: 'center' }}>Calculating…</div>;
  }
  if (error && !prediction) return null;
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
        padding: '14px 16px 12px',
        border: `1px solid ${cfg.color}22`,
      }}>
        <Gauge probability={probability} riskLevel={riskLevel} />

        {/* Factor breakdown */}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {Object.entries(factors).map(([key, value]) => {
            const name = FACTOR_LABELS[key];
            if (!name) return null;
            return <FactorRow key={key} name={name} value={value} factorKey={key} />;
          })}
        </div>

        {/* Meta info */}
        {meta && (
          <div style={{
            marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', flexWrap: 'wrap', gap: '3px 14px', fontSize: 10, color: '#444',
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
        )}
      </div>
    </div>
  );
}
