import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import LiveMap from './LiveMap';
import type { MapRider } from './LiveMap';
import type { LatestLocation, Profile, RiderStatus, TrackPoint } from './types';

const OFFLINE_AFTER_MS = 2 * 60 * 1000; // no update for 2 minutes = offline
const MOVING_SPEED_MS = 1; // metres per second (about 3.6 km/h)
const MAX_HOURS = 24;

const RANGES = [
  { label: '1 h', hours: 1 },
  { label: '8 h', hours: 8 },
  { label: '24 h', hours: 24 },
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
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
  const [customText, setCustomText] = useState('8'); // what is typed in the custom box
  const [trail, setTrail] = useState<TrackPoint[]>([]);
  const [follow, setFollow] = useState(false);
  const [query, setQuery] = useState('');
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

    async function loadTrail() {
      // Preferred: the database samples the whole period down to ~900 evenly
      // spaced points, so a 24-hour trail covers all 24 hours.
      const rpc = await supabase.rpc('rider_trail', {
        p_rider: selectedId,
        p_since: since,
        p_max: 900,
      });
      if (!active) return;
      if (!rpc.error) {
        setTrail((rpc.data ?? []) as TrackPoint[]);
        return;
      }

      // Fallback if rider_trail() has not been created yet: newest 1000 points only.
      const plain = await supabase
        .from('locations')
        .select('lat, lng, recorded_at')
        .eq('rider_id', selectedId)
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: false })
        .limit(1000);
      if (!active) return;
      if (plain.error) setError(plain.error.message);
      else setTrail(((plain.data ?? []) as TrackPoint[]).reverse());
    }
    void loadTrail();

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
        const name = r.full_name || 'Unnamed rider';
        return { id: r.id, name, initials: initialsOf(name), loc, status: statusOf(loc, now) };
      }),
    [riders, latest, now],
  );

  const counts = {
    moving: rows.filter((r) => r.status === 'moving').length,
    stopped: rows.filter((r) => r.status === 'stopped').length,
    offline: rows.filter((r) => r.status === 'offline' || r.status === 'no-data').length,
  };

  const visibleRows = rows.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = rows.find((r) => r.id === selectedId);

  const mapRiders: MapRider[] = rows
    .filter((r) => r.loc)
    .map((r) => ({
      id: r.id,
      name: r.name,
      initials: r.initials,
      lat: r.loc!.lat,
      lng: r.loc!.lng,
      status: r.status,
      speedKmh: (r.loc!.speed ?? 0) * 3.6,
      lastSeen: timeAgo(r.loc!.recorded_at, now),
    }));

  function select(id: string | null) {
    setSelectedId(id);
    setFollow(false);
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </svg>
          </div>
          <div className="grow">
            <h1>Rider Tracker</h1>
            <div className="muted small">{profile.full_name ?? 'Admin'}</div>
          </div>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </header>

        <div className="stats">
          <div className="stat">
            <span className="stat-num moving">{counts.moving}</span>
            <span className="stat-label">Moving</span>
          </div>
          <div className="stat">
            <span className="stat-num stopped">{counts.stopped}</span>
            <span className="stat-label">Stopped</span>
          </div>
          <div className="stat">
            <span className="stat-num offline">{counts.offline}</span>
            <span className="stat-label">Offline</span>
          </div>
        </div>

        {error && <p className="error pad-x">{error}</p>}

        <div className="search">
          <input
            type="search"
            placeholder="Search riders…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {selected ? (
          <section className="detail">
            <div className="detail-top">
              <div className={`avatar ${selected.status}`}>{selected.initials}</div>
              <div className="grow">
                <div className="name">{selected.name}</div>
                <div className="muted small">
                  {STATUS_LABEL[selected.status]}
                  {selected.status === 'moving' && selected.loc && ` · ${((selected.loc.speed ?? 0) * 3.6).toFixed(0)} km/h`}
                  {selected.loc && ` · ${timeAgo(selected.loc.recorded_at, now)}`}
                </div>
              </div>
              <button className="ghost" onClick={() => select(null)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="label">Trail</div>
            <div className="range">
              {RANGES.map((r) => (
                <button
                  key={r.hours}
                  className={r.hours === rangeHours ? 'chip active' : 'chip'}
                  onClick={() => {
                    setRangeHours(r.hours);
                    setCustomText(String(r.hours));
                  }}
                >
                  {r.label}
                </button>
              ))}
              <span className="custom">
                <input
                  className="hours-input"
                  type="number"
                  min={1}
                  max={MAX_HOURS}
                  step={1}
                  value={customText}
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    const n = Math.floor(Number(e.target.value));
                    if (n >= 1 && n <= MAX_HOURS) setRangeHours(n);
                  }}
                  onBlur={() => setCustomText(String(rangeHours))}
                  aria-label="Custom trail hours"
                />
                <span className="muted small">hours</span>
              </span>
            </div>

            <label className="switch">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              <span className="track" />
              <span>Follow this rider on the map</span>
            </label>
          </section>
        ) : (
          <p className="hint">Select a rider to see their route.</p>
        )}

        <div className="label list-label">Riders ({visibleRows.length})</div>
        <ul className="rider-list">
          {rows.length === 0 && <li className="muted pad">No riders yet. Create rider accounts in Supabase.</li>}
          {rows.length > 0 && visibleRows.length === 0 && <li className="muted pad">No rider matches “{query}”.</li>}
          {visibleRows.map((r) => (
            <li
              key={r.id}
              className={r.id === selectedId ? 'rider selected' : 'rider'}
              onClick={() => select(r.id === selectedId ? null : r.id)}
            >
              <div className={`avatar ${r.status}`}>{r.initials}</div>
              <div className="grow">
                <div className="name">{r.name}</div>
                <div className="muted small">
                  {STATUS_LABEL[r.status]}
                  {r.loc && ` · ${timeAgo(r.loc.recorded_at, now)}`}
                </div>
              </div>
              {r.status === 'moving' && r.loc && (
                <div className="speed">{((r.loc.speed ?? 0) * 3.6).toFixed(0)}<small> km/h</small></div>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <main>
        <LiveMap
          riders={mapRiders}
          selectedId={selectedId}
          trail={trail}
          follow={follow}
          onSelect={(id) => {
            setSelectedId(id);
          }}
          onUserPan={() => setFollow(false)}
        />
        <div className="legend">
          <span><i className="dot moving" /> Moving</span>
          <span><i className="dot stopped" /> Stopped</span>
          <span><i className="dot offline" /> Offline</span>
        </div>
      </main>
    </div>
  );
}