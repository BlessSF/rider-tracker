# Rider Tracker

Live GPS tracking for delivery riders, using the riders' own phones.

```
Rider phone (Expo app) ──► Supabase (database + login + realtime) ◄── Dashboard website (Vercel)
```

| Folder        | What it is                                         | Where it runs              |
|---------------|----------------------------------------------------|----------------------------|
| `supabase/`   | `schema.sql`: tables and security rules            | Supabase                   |
| `dashboard/`  | Admin website: live map, rider list, trails        | Vercel (free)              |
| `rider-app/`  | Rider phone app: login, Start/End shift, tracking  | Installed APK on Android   |

---

## Step 1: Supabase (about 10 minutes)

1. Create a free project at <https://supabase.com>. Pick the region nearest you (Singapore for the Philippines).
2. Open **SQL Editor -> New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Open **Project Settings -> API** and copy the **Project URL** and the **anon public key**. You need both below.
4. **Authentication -> Providers -> Email**: turn **off** "Confirm email" so riders you create can sign in straight away.
5. Create accounts under **Authentication -> Users -> Add user** (tick "Auto confirm user"):
   - one for you (the admin)
   - one per rider
   To set a rider's display name, edit the user's metadata: `{"full_name": "Juan Dela Cruz"}`.
   Without it, the name shows as the part of the email before the `@`.
6. Make yourself admin: in the SQL Editor run
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

Riders cannot see each other or anyone else's data. Only admins can read all locations.

## Step 2: Dashboard (try it locally, then put it on Vercel)

```bash
cd dashboard
cp .env.example .env        # paste your Supabase URL and anon key
npm install
npm run dev                 # open the address it prints
```

Deploy to Vercel:
1. Put this whole folder on GitHub.
2. In Vercel: **Add New -> Project**, pick the repo, and set **Root Directory** to `dashboard`.
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Sign in with your admin account.

## Step 3: Rider app

You need a **development/preview build**, not Expo Go, because background location does not work in Expo Go.

```bash
cd rider-app
cp .env.example .env              # same Supabase URL and anon key
npm install
npx expo install --fix            # aligns package versions with your Expo SDK
npm install -g eas-cli
eas login                         # free Expo account
eas build:configure               # first time only
eas build -p android --profile preview
```

Change `com.yourcompany.ridertracker` in `app.json` to your own id first.
When the build finishes, EAS gives a link to an **.apk**. Send it to your riders (Messenger, Viber, etc.) and have them install it (allow "install unknown apps").

Because `.env` values are baked in at build time, rebuild whenever you change them. For EAS builds you can also add them under your project's **Environment variables** in the Expo dashboard.

### What riders must do on their phone
1. Sign in, tap **Start shift**.
2. Choose **Allow all the time** for location when asked (needed for tracking with the screen off).
3. Android: **Settings -> Apps -> Rider Tracker -> Battery -> Unrestricted** (or "Don't optimize"). Many brands (Xiaomi, Oppo, Vivo, Realme, Samsung) kill background apps otherwise. See <https://dontkillmyapp.com> for per-brand steps.
4. Keep mobile data on and the phone charged (a mount and a car/bike charger are worth it).

## How it behaves
- The phone sends a point about every 3 seconds (change `UPDATE_EVERY_MS` in `rider-app/src/tracking.ts`). The dashboard marker moves live.
- Status: **Moving** (above ~3.6 km/h), **Stopped**, **Offline** (no update for 2 minutes).
- Click a rider to centre the map and show their trail (1, 8 or 24 hours).
- If a phone has no signal, the points taken during that time are lost (they are not saved and sent later). Adding an offline queue is a good next step, see below.

## Not built yet (good next steps)
- Orders and assigning deliveries to riders; customer tracking links.
- Geofences and alerts (rider offline, leaves area, long stop).
- Offline queue so points taken without signal are uploaded later.
- Delete history after 30 days automatically (see the last lines of `schema.sql`).
- Rider consent screen and privacy notice. Tell riders clearly when they are tracked.

## Free-tier notes
Supabase free tier is plenty for a small team to start. Each rider sends roughly 20 points a minute at the 3-second setting (about 1,200 an hour), so history grows quickly. Clean old data regularly or upgrade when you scale.
