import { useEffect, useRef, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { fetchPredictionTimeline } from '../api/client';

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

function riskColor(riskLevel) {
  return (RISK_CONFIG[riskLevel] || RISK_CONFIG.none).color;
}

/* ── Gauge ──────────────────────────────────────────────────────────── */
function Gauge({ probability, riskLevel }) {
  const cfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.none;
  const pct = Math.round(probability * 100);

  const cx = 120, cy = 100;
  const r = 80;
  const sw = 10;

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

  const segments = [
    { from: 0,    to: 0.25, color: '#22c55e' },
    { from: 0.25, to: 0.50, color: '#eab308' },
    { from: 0.50, to: 0.75, color: '#f97316' },
    { from: 0.75, to: 1.00, color: '#ef4444' },
  ];

  const needleAngle = Math.PI * (1 - Math.min(probability, 1));
  const needleLen = r - 20;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy - needleLen * Math.sin(needleAngle);

  return (
    <svg viewBox="0 0 240 130" width="100%" style={{ maxWidth: 240, display: 'block', margin: '0 auto' }}>
      <path
        d={arcPath(0, 1)}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={sw + 4}
        strokeLinecap="round"
      />
      {segments.map((seg, i) => {
        const segEnd = Math.min(probability, seg.to);
        if (segEnd <= seg.from) {
          return (
            <path key={i} d={arcPath(seg.from, seg.to)} fill="none"
              stroke={seg.color} strokeWidth={sw} strokeLinecap="butt"
              opacity={0.12}
            />
          );
        }
        const litEnd = Math.min(probability, seg.to);
        return (
          <g key={i}>
            {litEnd < seg.to && (
              <path d={arcPath(litEnd, seg.to)} fill="none"
                stroke={seg.color} strokeWidth={sw} strokeLinecap="butt"
                opacity={0.12}
              />
            )}
            <path d={arcPath(seg.from, litEnd)} fill="none"
              stroke={seg.color} strokeWidth={sw} strokeLinecap="butt"
              opacity={0.9}
            />
          </g>
        );
      })}
      <line x1={cx} y1={cy} x2={nx} y2={ny}
        stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.85}
      />
      <circle cx={cx} cy={cy} r={4} fill="#fff" opacity={0.7} />
      <text x={cx} y={cy - 22} textAnchor="middle" fill="#fff" fontSize="32" fontWeight="700"
        fontFamily="system-ui, sans-serif">
        {pct}%
      </text>
      <text x={cx} y={cy - 4} textAnchor="middle" fill={cfg.color} fontSize="13" fontWeight="600"
        fontFamily="system-ui, sans-serif">
        {cfg.label}
      </text>
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

/* ── Custom Tooltip for timeline chart ──────────────────────────────── */
function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const cfg = RISK_CONFIG[d.riskLevel] || RISK_CONFIG.none;
  return (
    <div style={{
      background: '#1e1e2e',
      border: `1px solid ${cfg.color}55`,
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 12,
      color: '#fff',
    }}>
      <div style={{ fontWeight: 600 }}>{d.label}</div>
      <div style={{ color: cfg.color }}>{cfg.label} · {Math.round(d.probability * 100)}%</div>
    </div>
  );
}

/* ── Timeline Chart ─────────────────────────────────────────────────── */
function TimelineChart({ predictions, selectedOffset, onSelectOffset }) {
  if (!predictions || predictions.length === 0) return null;

  // Color each data point dot by risk level
  const CustomDot = ({ cx, cy, payload }) => {
    const isSelected = payload.offset === selectedOffset;
    const color = riskColor(payload.riskLevel);
    return (
      <circle
        cx={cx} cy={cy}
        r={isSelected ? 5 : 3}
        fill={isSelected ? '#fff' : color}
        stroke={color}
        strokeWidth={isSelected ? 2 : 0}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelectOffset(payload.offset)}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={110}>
      <AreaChart
        data={predictions}
        margin={{ top: 8, right: 4, bottom: 0, left: -28 }}
        onClick={(e) => {
          if (e?.activePayload?.[0]) {
            onSelectOffset(e.activePayload[0].payload.offset);
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        <defs>
          <linearGradient id="probGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fill: '#555', fontSize: 10 }}
          interval="preserveStartEnd"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          tick={{ fill: '#444', fontSize: 9 }}
          tickLine={false}
          axisLine={false}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
        />
        <Tooltip content={<TimelineTooltip />} />
        {/* Reference line for selected hour */}
        {predictions[selectedOffset] && (
          <ReferenceLine
            x={predictions[selectedOffset].label}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="3 3"
          />
        )}
        <Area
          type="monotone"
          dataKey="probability"
          stroke="#ef4444"
          strokeWidth={1.5}
          fill="url(#probGrad)"
          dot={<CustomDot />}
          activeDot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Hour Selector Pills ─────────────────────────────────────────────── */
function HourPills({ predictions, selectedOffset, onSelectOffset }) {
  const scrollRef = useRef(null);

  // Scroll active pill into view on selection change
  useEffect(() => {
    if (!scrollRef.current) return;
    const active = scrollRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [selectedOffset]);

  if (!predictions || predictions.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        paddingBottom: 2,
        scrollbarWidth: 'none',
      }}
    >
      {predictions.map((p) => {
        const isActive = p.offset === selectedOffset;
        const color = riskColor(p.riskLevel);
        return (
          <button
            key={p.offset}
            data-active={isActive}
            onClick={() => onSelectOffset(p.offset)}
            style={{
              flexShrink: 0,
              padding: '4px 9px',
              borderRadius: 14,
              border: `1px solid ${isActive ? color : 'rgba(255,255,255,0.1)'}`,
              background: isActive ? `${color}22` : 'transparent',
              color: isActive ? color : '#555',
              fontSize: 11,
              fontWeight: isActive ? 700 : 400,
              cursor: 'pointer',
              transition: 'all 0.12s',
              whiteSpace: 'nowrap',
            }}
          >
            {p.offset === 0 ? 'Now' : p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────── */
export default function PredictionGauge({ area }) {
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedOffset, setSelectedOffset] = useState(0);

  useEffect(() => {
    if (!area) {
      setTimeline(null);
      return;
    }

    let mounted = true;

    const loadPrediction = async () => {
      if (!mounted) return;

      try {
        const data = await fetchPredictionTimeline(area, 12);
        if (mounted) setTimeline(data);
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    setLoading(true);
    setError(null);
    setSelectedOffset(0);
    loadPrediction();

    // Refresh prediction every 60 seconds
    const id = setInterval(() => {
      if (mounted) {
        loadPrediction().catch(() => {});
      }
    }, 60_000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [area]);

  if (!area) return null;
  if (loading && !timeline) {
    return <div style={{ padding: '12px 0', color: '#555', fontSize: 12, textAlign: 'center' }}>Calculating…</div>;
  }
  if (error && !timeline) return null;
  if (!timeline) return null;

  const predictions = timeline.predictions || [];
  const selected = predictions[selectedOffset] ?? predictions[0];
  if (!selected) return null;

  const { probability, riskLevel, factors } = selected;
  const cfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.none;

  const selectedLabel = selectedOffset === 0 ? 'Next Hour' : selected.label;

  return (
    <div style={{ padding: '16px 20px 8px' }}>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Attack Probability · {selectedLabel}
        </div>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 12,
        padding: '14px 16px 12px',
        border: `1px solid ${cfg.color}22`,
      }}>
        {/* Hour selector pills */}
        <HourPills
          predictions={predictions}
          selectedOffset={selectedOffset}
          onSelectOffset={setSelectedOffset}
        />

        {/* Gauge */}
        <div style={{ marginTop: 10 }}>
          <Gauge probability={probability} riskLevel={riskLevel} />
        </div>

        {/* 12-hour timeline chart */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: '#444', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            12-Hour Horizon
          </div>
          <TimelineChart
            predictions={predictions}
            selectedOffset={selectedOffset}
            onSelectOffset={setSelectedOffset}
          />
        </div>

        {/* Factor breakdown */}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {Object.entries(factors).map(([key, value]) => {
            const name = FACTOR_LABELS[key];
            if (!name) return null;
            return <FactorRow key={key} name={name} value={value} factorKey={key} />;
          })}
        </div>

        {/* Meta info — always from offset-0 (real-time stats) */}
        {predictions[0]?.meta && (
          <div style={{
            marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', flexWrap: 'wrap', gap: '3px 14px', fontSize: 10, color: '#444',
          }}>
            {predictions[0].meta.alertsLast24h != null && (
              <span>{predictions[0].meta.alertsLast24h} alerts in 24h</span>
            )}
            {predictions[0].meta.hoursSinceLastAlert != null && (
              <span>Last alert {predictions[0].meta.hoursSinceLastAlert < 1
                ? `${Math.round(predictions[0].meta.hoursSinceLastAlert * 60)}m ago`
                : `${predictions[0].meta.hoursSinceLastAlert.toFixed(1)}h ago`}
              </span>
            )}
            {predictions[0].meta.totalAlerts > 0 && (
              <span>{predictions[0].meta.totalAlerts} total in {predictions[0].meta.observationHours.toFixed(0)}h window</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
