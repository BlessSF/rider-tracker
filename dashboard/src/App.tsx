import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import Login from './Login';
import Dashboard from './Dashboard';
import type { Profile } from './types';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      });
  }, [session]);

  if (!configured) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Setup needed</h1>
          <p>
            Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to a <code>.env</code> file
            (or to your Vercel project's environment variables), then restart.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="center-screen muted">Loading…</div>;
  if (!session) return <Login />;

  if (profile?.role !== 'admin') {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>No access</h1>
          <p>This account is not an admin. Ask the owner to set your role to admin in Supabase.</p>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  return <Dashboard profile={profile} />;
}
