import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import LiveMap from './LiveMap';
import type { MapRider } from './LiveMap';
import type { LatestLocation, Profile, RiderStatus, TrackPoint } from './types';

const OFFLINE_AFTER_MS = 2 * 60 * 1000; // no update for 2 minutes = offline
const MOVING_SPEED_MS = 1; // metres per second (about 3.6 km/h)

const RANGES = [
  { label: '1 hour', hours: 1 },
  { label: '8 hours', hours: 8 },
  { label: '24 hours', hours: 24 },
];

function statusOf(loc: LatestLocation | undefined, now: number): RiderStatus {
  if (!loc) return 'no-data';
  if (now - new Date(loc.recorded_at).getTime() > OFFLINE_AFTER_MS) return 'offline';
  return (loc.speed ?? 0) > MOVING_SPEED_MS ? 'moving' : 'stopped';
}

function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const STATUS_LABEL: Record<RiderStatus, string> = {
  moving: 'Moving',
  stopped: 'Stopped',
  offline: 'Offline',
  'no-data': 'No data yet',
};

export default function Dashboard({ profile }: { profile: Profile }) {
  const [riders, setRiders] = useState<Profile[]>([]);
  const [latest, setLatest] = useState<Record<string, LatestLocation>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState(8);
  const [trail, setTrail] = useState<TrackPoint[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  // Re-evaluate "online/offline" every 10 seconds even if no new data arrives.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Initial load + live updates.
  useEffect(() => {
    let active = true;

    async function load() {
      const [p, l] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').eq('role', 'rider').order('full_name'),
        supabase.from('latest_locations').select('*'),
      ]);
      if (!active) return;
      if (p.error || l.error) {
        setError((p.error ?? l.error)!.message);
        return;
      }
      setRiders(p.data as Profile[]);
      setLatest(Object.fromEntries((l.data as LatestLocation[]).map((x) => [x.rider_id, x])));
    }
    void load();

    const channel = supabase
      .channel('latest-locations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'latest_locations' },
        (payload) => {
          const row = payload.new as LatestLocation;
          if (!row?.rider_id) return;
          setLatest((prev) => ({ ...prev, [row.rider_id]: row }));
        },
      )
      .subscribe();

    // A rider who signs up after the dashboard opens should still appear.
    const profileChannel = supabase
      .channel('profiles')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => void load())
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
      void supabase.removeChannel(profileChannel);
    };
  }, []);

  // Load the trail for the selected rider.
  useEffect(() => {
    if (!selectedId) {
      setTrail([]);
      return;
    }
    let active = true;
    const since = new Date(Date.now() - rangeHours * 3600_000).toISOString();
    supabase
      .from('locations')
      .select('lat, lng, recorded_at')
      .eq('rider_id', selectedId)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: false })
      .limit(1000) // newest 1000 points
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setTrail(((data ?? []) as TrackPoint[]).reverse());
      });
    return () => {
      active = false;
    };
  }, [selectedId, rangeHours]);

  // Extend the trail live as new points arrive for the selected rider.
  const selectedLatest = selectedId ? latest[selectedId] : undefined;
  useEffect(() => {
    if (!selectedLatest) return;
    setTrail((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.recorded_at >= selectedLatest.recorded_at) return prev;
      return [
        ...prev,
        { lat: selectedLatest.lat, lng: selectedLatest.lng, recorded_at: selectedLatest.recorded_at },
      ];
    });
  }, [selectedLatest]);

  const rows = useMemo(
    () =>
      riders.map((r) => {
        const loc = latest[r.id];
        return {
          id: r.id,
          name: r.full_name || 'Unnamed rider',
          loc,
          status: statusOf(loc, now),
        };
      }),
    [riders, latest, now],
  );

  const mapRiders: MapRider[] = rows
    .filter((r) => r.loc)
    .map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.loc!.lat,
      lng: r.loc!.lng,
      status: r.status,
      speedKmh: (r.loc!.speed ?? 0) * 3.6,
      lastSeen: timeAgo(r.loc!.recorded_at, now),
    }));

  const onlineCount = rows.filter((r) => r.status === 'moving' || r.status === 'stopped').length;

  return (
    <div className="layout">
      <aside className="sidebar">
        <header>
          <h1>Rider Tracker</h1>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </header>
        <p className="muted small">
          {profile.full_name ?? 'Admin'} · {onlineCount} of {rows.length} riders online
        </p>

        {error && <p className="error">{error}</p>}

        <div className="range">
          <span className="muted small">Trail:</span>
          {RANGES.map((r) => (
            <button
              key={r.hours}
              className={r.hours === rangeHours ? 'chip active' : 'chip'}
              onClick={() => setRangeHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <ul className="rider-list">
          {rows.length === 0 && <li className="muted pad">No riders yet. Create rider accounts in Supabase.</li>}
          {rows.map((r) => (
            <li
              key={r.id}
              className={r.id === selectedId ? 'rider selected' : 'rider'}
              onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
            >
              <span className={`dot ${r.status}`} />
              <div className="grow">
                <div className="name">{r.name}</div>
                <div className="muted small">
                  {STATUS_LABEL[r.status]}
                  {r.loc && ` · ${timeAgo(r.loc.recorded_at, now)}`}
                  {r.status === 'moving' && r.loc && ` · ${((r.loc.speed ?? 0) * 3.6).toFixed(0)} km/h`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        <LiveMap riders={mapRiders} selectedId={selectedId} trail={trail} onSelect={setSelectedId} />
      </main>
    </div>
  );
}
