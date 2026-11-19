-- Rider Tracker schema for Supabase.
-- Run this once in: Supabase dashboard -> SQL Editor -> New query -> Run.

-- 1. Profiles: one row per user (rider or admin) ------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        text not null default 'rider' check (role in ('rider', 'admin')),
  created_at  timestamptz not null default now()
);

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by security rules. security definer avoids recursive policy checks.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- 2. Full location history ----------------------------------------------------
create table if not exists public.locations (
  id           bigint generated always as identity primary key,
  rider_id     uuid not null references public.profiles (id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  speed        real,              -- metres per second
  heading      real,              -- degrees
  accuracy     real,              -- metres
  recorded_at  timestamptz not null default now()
);

create index if not exists locations_rider_time_idx
  on public.locations (rider_id, recorded_at desc);

-- 3. Latest position per rider (what the live map reads) ----------------------
create table if not exists public.latest_locations (
  rider_id     uuid primary key references public.profiles (id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  speed        real,
  heading      real,
  accuracy     real,
  recorded_at  timestamptz not null
);

-- Keep latest_locations up to date whenever a new location arrives.
create or replace function public.upsert_latest_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.latest_locations as l
    (rider_id, lat, lng, speed, heading, accuracy, recorded_at)
  values
    (new.rider_id, new.lat, new.lng, new.speed, new.heading, new.accuracy, new.recorded_at)
  on conflict (rider_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        speed = excluded.speed,
        heading = excluded.heading,
        accuracy = excluded.accuracy,
        recorded_at = excluded.recorded_at
    where excluded.recorded_at >= l.recorded_at;  -- ignore late/out-of-order points
  return new;
end;
$$;

drop trigger if exists on_location_insert on public.locations;
create trigger on_location_insert
  after insert on public.locations
  for each row execute function public.upsert_latest_location();

-- 4. Security rules (Row Level Security) --------------------------------------
alter table public.profiles         enable row level security;
alter table public.locations        enable row level security;
alter table public.latest_locations enable row level security;

-- Profiles: you see your own; admins see everyone.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Locations: a rider can only add points for themselves; admins read all.
drop policy if exists "locations insert own" on public.locations;
create policy "locations insert own" on public.locations
  for insert with check (rider_id = auth.uid());

drop policy if exists "locations read" on public.locations;
create policy "locations read" on public.locations
  for select using (rider_id = auth.uid() or public.is_admin());

-- Latest locations: read-only for clients (the trigger writes to it).
drop policy if exists "latest read" on public.latest_locations;
create policy "latest read" on public.latest_locations
  for select using (rider_id = auth.uid() or public.is_admin());

-- 5. Live updates for the dashboard -------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.latest_locations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

-- 6. Optional: delete history older than 30 days (run manually or schedule) ---
-- delete from public.locations where recorded_at < now() - interval '30 days';

-- AFTER you create your own account, make yourself admin (replace the email):
-- update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
