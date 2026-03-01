import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const CATEGORY_COLORS = {
  1: '#ef4444',
  2: '#f97316',
  3: '#8b5cf6',
  7: '#ec4899',
  8: '#dc2626',
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
            eventHandlers={{
              click: (e) => {
                e.originalEvent.stopPropagation();
                onSelectArea(area.area_name_he);
              },
            }}
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

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          left: 10,
          zIndex: 1000,
          background: 'rgba(15,15,25,0.88)',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 12,
          lineHeight: '1.8',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {[
          [1, 'Rocket / Missile'],
          [2, 'UAV / Drone'],
          [3, 'Earthquake'],
          [7, 'Hostile Aircraft'],
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
