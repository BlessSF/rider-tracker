import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { RiderStatus, TrackPoint } from './types';

export interface MapRider {
  id: string;
  name: string;
  initials: string;
  lat: number;
  lng: number;
  status: RiderStatus;
  speedKmh: number;
  lastSeen: string;
}

const COLORS: Record<RiderStatus, string> = {
  moving: '#16a34a',
  stopped: '#f59e0b',
  offline: '#94a3b8',
  'no-data': '#94a3b8',
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function makeIcon(color: string, initials: string, selected: boolean, pulse: boolean) {
  const size = selected ? 44 : 36;
  return L.divIcon({
    className: 'pin-wrap',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div class="pin${pulse ? ' pulse' : ''}${selected ? ' sel' : ''}" style="--c:${color};width:${size}px;height:${size}px"><span>${escapeHtml(initials)}</span></div>`,
  });
}

/** Zooms to all riders once, flies to a rider when selected, and follows it if asked. */
function MapController({
  riders,
  focusId,
  follow,
  onUserPan,
}: {
  riders: MapRider[];
  focusId: string | null;
  follow: boolean;
  onUserPan: () => void;
}) {
  const map = useMap();
  const fitted = useRef(false);

  useMapEvents({
    dragstart: onUserPan, // the admin moved the map by hand, so stop following
  });

  useEffect(() => {
    if (fitted.current || riders.length === 0) return;
    const bounds = L.latLngBounds(riders.map((r) => [r.lat, r.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 15 });
    fitted.current = true;
  }, [riders, map]);

  // Fly to a rider when it is selected.
  useEffect(() => {
    if (!focusId) return;
    const r = riders.find((x) => x.id === focusId);
    if (r) map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
    // Only when the selection changes, not on every location update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, map]);

  // Follow mode: keep the selected rider in view as they move.
  const followed = riders.find((x) => x.id === focusId);
  useEffect(() => {
    if (!follow || !followed) return;
    map.panTo([followed.lat, followed.lng], { animate: true, duration: 0.8 });
  }, [follow, followed?.lat, followed?.lng, map]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

interface Props {
  riders: MapRider[];
  selectedId: string | null;
  trail: TrackPoint[];
  follow: boolean;
  onSelect: (id: string) => void;
  onUserPan: () => void;
}

export default function LiveMap({ riders, selectedId, trail, follow, onSelect, onUserPan }: Props) {
  const positions = trail.map((p) => [p.lat, p.lng] as [number, number]);
  return (
    <MapContainer center={[12.88, 121.77]} zoom={6} className="map" scrollWheelZoom zoomControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController riders={riders} focusId={selectedId} follow={follow} onUserPan={onUserPan} />

      {positions.length > 1 && (
        <>
          {/* white outline under the blue line so it reads on any map colour */}
          <Polyline positions={positions} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
          <Polyline positions={positions} pathOptions={{ color: '#2563eb', weight: 4.5, opacity: 0.95 }} />
          <CircleMarker
            center={positions[0]}
            radius={6}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#64748b', fillOpacity: 1 }}
          >
            <Popup>Start of trail</Popup>
          </CircleMarker>
        </>
      )}

      {riders.map((r) => (
        <Marker
          key={r.id}
          position={[r.lat, r.lng]}
          zIndexOffset={r.id === selectedId ? 1000 : 0}
          icon={makeIcon(COLORS[r.status], r.initials, r.id === selectedId, r.status === 'moving')}
          eventHandlers={{ click: () => onSelect(r.id) }}
        >
          <Popup>
            <div className="popup">
              <strong>{r.name}</strong>
              <div className="popup-row">
                <span className="popup-dot" style={{ background: COLORS[r.status] }} />
                {r.status === 'moving' ? `Moving · ${r.speedKmh.toFixed(0)} km/h` : r.status === 'stopped' ? 'Stopped' : 'Offline'}
              </div>
              <div className="popup-muted">Last seen {r.lastSeen}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}