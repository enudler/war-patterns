import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const CATEGORY_COLORS = {
  1: '#ef4444',
  2: '#f97316',
  default: '#3b82f6',
};

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default;
}

function radiusForCount(count) {
  if (count === 0) return 5;
  if (count <= 2) return 7;
  if (count <= 10) return 11;
  if (count <= 30) return 16;
  if (count <= 100) return 22;
  return 28;
}

// Pans map to fit all markers on first load
function AutoFit({ areas }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (areas.length === 0 || fitted.current) return;
    const lats = areas.filter((a) => a.lat).map((a) => parseFloat(a.lat));
    const lons = areas.filter((a) => a.lon).map((a) => parseFloat(a.lon));
    if (lats.length === 0) return;
    map.fitBounds([
      [Math.min(...lats) - 0.5, Math.min(...lons) - 0.5],
      [Math.max(...lats) + 0.5, Math.max(...lons) + 0.5],
    ], { padding: [20, 20] });
    fitted.current = true;
  }, [areas, map]);

  return null;
}

// Flies to the selected area whenever selectedArea changes.
// Uses a ref for areas so the 30s data refresh doesn't re-trigger the zoom.
function ZoomToSelected({ areas, selectedArea }) {
  const map = useMap();
  const areasRef = useRef(areas);
  areasRef.current = areas;

  useEffect(() => {
    if (!selectedArea) return;
    const area = areasRef.current.find((a) => a.area_name_he === selectedArea);
    if (!area?.lat || !area?.lon) return;
    map.flyTo([parseFloat(area.lat), parseFloat(area.lon)], 12, { duration: 1 });
  }, [selectedArea, map]); // areas read via ref — no re-zoom on 30s refresh

  return null;
}

// Clicking empty map space selects the nearest area
function MapClickHandler({ areas, onSelectArea }) {
  useMapEvents({
    click(e) {
      if (!areas.length) return;
      const { lat, lng } = e.latlng;
      let nearest = null;
      let minDist = Infinity;
      for (const area of areas) {
        if (!area.lat || !area.lon) continue;
        const dlat = parseFloat(area.lat) - lat;
        const dlon = parseFloat(area.lon) - lng;
        const dist = dlat * dlat + dlon * dlon;
        if (dist < minDist) { minDist = dist; nearest = area; }
      }
      if (nearest) onSelectArea(nearest.area_name_he);
    },
  });
  return null;
}

export default function Map({ areas, selectedArea, onSelectArea, days }) {
  const [picker, setPicker] = useState(null); // { lat, lon, options: Area[] }

  // Group areas by coordinate to detect stacks
  const coordGroups = {};
  for (const a of areas) {
    if (!a.lat || !a.lon) continue;
    const key = `${a.lat},${a.lon}`;
    if (!coordGroups[key]) coordGroups[key] = [];
    coordGroups[key].push(a);
  }

  function handleMarkerClick(e, area) {
    e.originalEvent.stopPropagation();
    const key = `${area.lat},${area.lon}`;
    const siblings = (coordGroups[key] || []).filter((a) => parseInt(a.alert_count, 10) > 0);
    if (siblings.length > 1) {
      setPicker({ lat: parseFloat(area.lat), lon: parseFloat(area.lon), options: siblings });
    } else {
      onSelectArea(area.area_name_he);
    }
  }

  return (
    <MapContainer
      center={[31.5, 34.9]}
      zoom={8}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <AutoFit areas={areas} />
      <ZoomToSelected areas={areas} selectedArea={selectedArea} />
      <MapClickHandler areas={areas} onSelectArea={onSelectArea} />

      {areas.map((area) => {
        const lat = parseFloat(area.lat);
        const lon = parseFloat(area.lon);
        if (!lat || !lon) return null;

        const count = parseInt(area.alert_count, 10) || 0;
        const cat = parseInt(area.dominant_category, 10);
        const isSelected = selectedArea === area.area_name_he;
        const hasAlerts = count > 0;
        const color = hasAlerts ? categoryColor(cat) : '#4b5563';

        return (
          <CircleMarker
            key={area.area_name_he}
            center={[lat, lon]}
            radius={radiusForCount(count)}
            pathOptions={{
              color: isSelected ? '#fff' : color,
              fillColor: color,
              fillOpacity: isSelected ? 0.95 : hasAlerts ? 0.7 : 0.25,
              weight: isSelected ? 3 : hasAlerts ? 1.5 : 1,
            }}
            eventHandlers={{ click: (e) => handleMarkerClick(e, area) }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
              <div style={{ fontFamily: 'sans-serif', fontSize: 12 }}>
                <strong>{area.area_name}</strong>
                <br />
                {hasAlerts
                  ? <><span style={{ color }}>{count} alert{count !== 1 ? 's' : ''}</span>{' '}
                      {days === 'today' ? 'today' : `in ${days}d`}</>
                  : <span style={{ color: '#888' }}>No alerts {days === 'today' ? 'today' : `in ${days}d`}</span>
                }
                {hasAlerts && (
                  <><br /><span style={{ color }}>{area.dominant_category_desc}</span></>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}

      {picker && (
        <Popup
          position={[picker.lat, picker.lon]}
          onClose={() => setPicker(null)}
          closeButton={false}
        >
          <div style={{ fontFamily: 'sans-serif', fontSize: 13, minWidth: 160 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#333' }}>
              {picker.options[0].area_name} — choose sub-area:
            </div>
            {picker.options.map((opt) => {
              const count = parseInt(opt.alert_count, 10) || 0;
              const cat = parseInt(opt.dominant_category, 10);
              const color = count > 0 ? categoryColor(cat) : '#9ca3af';
              return (
                <div
                  key={opt.area_name_he}
                  onClick={() => { onSelectArea(opt.area_name_he); setPicker(null); }}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 2,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#111' }}>{opt.area_name_he}</span>
                  <span style={{ color, fontWeight: 600, fontSize: 12, flexShrink: 0 }}>
                    {count > 0 ? `${count} alerts` : 'no alerts'}
                  </span>
                </div>
              );
            })}
          </div>
        </Popup>
      )}

      {/* Legend */}
      <div
        className="map-legend"
        style={{
          position: 'absolute',
          bottom: 30,
          left: 10,
          zIndex: 1000,
          background: 'rgba(15,15,25,0.88)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 11,
          lineHeight: '1.8',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {[
          [1, 'Rocket / Missile'],
          [2, 'UAV / Drone'],
        ].map(([cat, label]) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: categoryColor(cat) }} />
            {label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#4b5563', opacity: 0.5 }} />
          <span style={{ color: '#888' }}>No alerts</span>
        </div>
        <div style={{ marginTop: 6, color: '#aaa', fontSize: 11 }}>
          Click anywhere to select nearest area
        </div>
      </div>
    </MapContainer>
  );
}
