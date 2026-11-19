import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { RiderStatus, TrackPoint } from './types';

export interface MapRider {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: RiderStatus;
  speedKmh: number;
  lastSeen: string;
}

const COLORS: Record<RiderStatus, string> = {
  moving: '#16a34a',
  stopped: '#f59e0b',
  offline: '#9ca3af',
  'no-data': '#9ca3af',
};

function makeIcon(color: string, selected: boolean) {
  const size = selected ? 26 : 20;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45)"></div>`,
  });
}

/** Zooms to all riders once, and flies to a rider when one is selected. */
function MapController({ riders, focusId }: { riders: MapRider[]; focusId: string | null }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || riders.length === 0) return;
    const bounds = L.latLngBounds(riders.map((r) => [r.lat, r.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    fitted.current = true;
  }, [riders, map]);

  useEffect(() => {
    if (!focusId) return;
    const r = riders.find((x) => x.id === focusId);
    if (r) map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
    // Only re-run when the selection changes, not on every location update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, map]);

  return null;
}

interface Props {
  riders: MapRider[];
  selectedId: string | null;
  trail: TrackPoint[];
  onSelect: (id: string) => void;
}

export default function LiveMap({ riders, selectedId, trail, onSelect }: Props) {
  return (
    <MapContainer center={[12.88, 121.77]} zoom={6} className="map" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController riders={riders} focusId={selectedId} />
      {trail.length > 1 && (
        <Polyline
          positions={trail.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.75 }}
        />
      )}
      {riders.map((r) => (
        <Marker
          key={r.id}
          position={[r.lat, r.lng]}
          icon={makeIcon(COLORS[r.status], r.id === selectedId)}
          eventHandlers={{ click: () => onSelect(r.id) }}
        >
          <Popup>
            <strong>{r.name}</strong>
            <br />
            {r.status === 'offline' ? 'Offline' : `${r.speedKmh.toFixed(0)} km/h`}
            <br />
            <span className="muted">Last seen {r.lastSeen}</span>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
