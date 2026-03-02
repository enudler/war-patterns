import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';

const TYPE_COLORS = {
  'Rocket / Missile': '#ef4444',
  'UAV / Drone': '#f97316',
};

function typeColor(desc) {
  return TYPE_COLORS[desc] ?? '#3b82f6';
}

const tooltipStyle = {
  contentStyle: {
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
  },
};

export function DailyBarChart({ data }) {
  if (!data || data.length === 0) {
    return <p style={{ color: '#888', fontSize: 13 }}>No data for this period.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="date"
          tick={{ fill: '#aaa', fontSize: 11 }}
          tickFormatter={(v) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
        />
        <YAxis tick={{ fill: '#aaa', fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(v) => new Date(v).toLocaleDateString()}
          formatter={(v) => [v, 'Alerts']}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill="#ef4444" fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HourlyBarChart({ data }) {
  // Fill missing hours with 0
  const full = Array.from({ length: 24 }, (_, h) => {
    const found = (data || []).find((d) => d.hour === h);
    return { hour: h, count: found ? found.count : 0 };
  });

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={full} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="hour"
          tick={{ fill: '#aaa', fontSize: 10 }}
          tickFormatter={(h) => `${h}:00`}
          interval={3}
        />
        <YAxis tick={{ fill: '#aaa', fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(h) => `${h}:00 – ${h + 1}:00`}
          formatter={(v) => [v, 'Alerts']}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {full.map((d, i) => (
            <Cell
              key={i}
              fill={d.count > 0 ? '#f97316' : '#374151'}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TypePieChart({ data }) {
  if (!data || data.length === 0) return null;

  const pieData = data.map((d) => ({
    name: d.category_desc,
    value: d.count,
    fill: typeColor(d.category_desc),
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={70}
          dataKey="value"
          paddingAngle={3}
        >
          {pieData.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          {...tooltipStyle}
          formatter={(v, name) => [v, name]}
        />
        <Legend
          iconType="circle"
          iconSize={9}
          formatter={(value) => (
            <span style={{ color: '#ccc', fontSize: 11 }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
