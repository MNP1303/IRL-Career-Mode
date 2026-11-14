# IRL Career Mode

A football career mode for your real life. Log the matches you actually play, map where you played on the pitch, and watch your player card develop from what you recorded.

The app opens on a clearly labelled demo career (the fictional Kai Mercer and 24 sample matches). Choose **Start my career** to remove the sample data.

## Run it

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

| Command                          | What it does                   |
| -------------------------------- | ------------------------------ |
| `npm run dev`                    | Development server             |
| `npm run build` then `npm start` | Production build               |
| `npm run check`                  | Typecheck, lint and unit tests |
| `npm test`                       | Unit tests only                |

## Accounts (optional)

Without any setup the app runs in guest mode and saves to the browser, as before. Connecting a free [Supabase](https://supabase.com) project adds sign-in, so a career syncs across devices and survives clearing the browser.

### 1. Create the database

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor**, paste the contents of [`supabase/migrations/20261105120000_accounts.sql`](supabase/migrations/20261105120000_accounts.sql) and select **Run**. It creates the `profiles` and `matches` tables with row-level security, and is safe to run again.
3. For GPS imports, run [`supabase/migrations/20261112120000_gps_tracking.sql`](supabase/migrations/20261112120000_gps_tracking.sql) the same way, after the first one. It adds three owner-only tables, an `attach_gps_track` function and a private `gps-files` storage bucket. It needs Postgres 15 or newer (every current Supabase project is). Guests don't need it: their GPS data stays in the browser.

### 2. Configure sign-in

In **Authentication → URL Configuration**:

- Set **Site URL** to `http://localhost:3000`.
- Under **Redirect URLs**, add `http://localhost:3000/**`. Add your real domain too when you deploy.

Email and password sign-in is enabled by default. New accounts must confirm their email first. Supabase's built-in email service only sends a few emails an hour and is meant for testing, so either set up custom SMTP (**Authentication → Emails**) or, for local testing only, switch off **Confirm email** under **Authentication → Sign In / Providers → Email**.

### 3. Add your keys

Open the project's **Connect** dialog, or **Project Settings → API Keys**, and copy the project URL and the **publishable** key (`sb_publishable_…`). Then:

```bash
cp .env.example .env.local
```

Paste both values into `.env.local` and restart `npm run dev`. Next.js reads these variables at startup, so a running server won't pick them up. The older `anon` key also works if you name it `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Never put the **secret** or `service_role` key in this app. Everything here runs in the browser, and row-level security is what keeps each player's data private.

### How syncing works

- Signing in on a browser that already has a guest career offers to copy it into the account. Demo data is never copied, and the guest copy stays in the browser.
- Every change is saved locally first, then sent to Supabase. If you're offline or a request fails, changes wait in a queue (kept in the browser) and retry automatically or from **Account → Sync now**.
- The app pulls from the server when you sign in and when you return to the tab, so matches logged on another device appear.
- Signing out removes the account's copy from that browser and returns to the guest career.
- **Account → Delete account** removes the login, every synced match and all GPS imports and files.

## How progression works

The rules live in `src/lib/engine/rules.ts`, and the in-app **Career → How it works** tab reads the same values, so the published rules can't drift from the real ones.

- **Attributes** start at 50. A skill rating sets a target of rating × 10, and each match closes 10% of the gap, scaled by minutes and format, capped at +2 / −1.5 per match.
- **Goals and assists** add a small bonus to SHO and PAS that shrinks as the attribute climbs.
- **Nothing is inferred.** Unrated skills don't move, attributes don't decay between matches, and the overall match rating only affects XP.
- **XP** is itemised per match: appearance, minutes, rating above 5, goals, assists, result and recorded clean sheets.
- **OVR** is a position-weighted average of the six attributes.

All ratings are self-assessed, so the card shows your own view of your game, not an external scouting report.

## GPS tracking

A match can carry a GPS recording from a watch or phone, turned into a heatmap and match metrics. It's purely analytical: **GPS never changes ratings, XP, attributes or any match stat**, and manual zones stay exactly as logged.

**Import** from a match page (**GPS tracking → Import GPS file**) or while logging a match: under **Pitch map**, choose **Paint it myself** or **From a GPS file**. A new match is mapped one way or the other. When editing, the choice sets which heatmap the match shows, and painted zones are never deleted. The wizard runs entirely in the browser, with parsing and processing in a Web Worker, and nothing is saved until the last step:

1. **File**: GPX 1.0/1.1, TCX or FIT, up to 25 MB. The format is detected from the contents, never the extension. XML with a DTD or entities is refused, and FIT files are checksum-verified with Garmin's official decoder.
2. **Preview**: date, duration, route (on a plain metre grid; no map tiles are loaded, so the location isn't sent anywhere), point count, whole-recording metrics and anything screening noticed.
3. **Trim**: one or more playing intervals, to leave out warm-ups and breaks. Nothing assumes 90 minutes or two halves; intervals are never joined, and an interval can be marked "teams switched ends".
4. **Pitch**: a 5-, 7- or 11-a-side preset or a custom size, plus the four corners. On arrival the pitch is **found from the movement** (`src/lib/gps/detect.ts`, no map data or network): the rectangle of the stated size is turned and moved to hold the most playing time, ties are broken by running direction, and the player's position for the match places them on it (a centre back near their own goal), which also settles the attacking direction when the movement can show it. When it can't, the wizard asks which compass direction they attacked in the first half. It reports its confidence, suggests a standard size that fits much better, and says plainly when a small area of play can't pin the pitch down. Detected corners keep the heatmap marked *Approximate*. Corners can also be placed on the route, dragged, moved from the keyboard or pasted as coordinates from any map app. Named pitches can be saved and reused. The pitch is fitted with a rigid transform (rotation and translation only), so a mismatch between the corners and the size is reported, never stretched away.
5. **Heatmap**: quality (Usable, Approximate or Insufficient, with reasons), metrics with their provenance, and every excluded point counted by reason.
6. **Attach**: explicit confirmation. Replacing, re-trimming, recalibrating and removing are on the match page.

**Season heatmap.** The **Pitch** page switches between **Painted zones** and **GPS files**. GPS matches are scaled by relative position from their own pitch size onto a standard 105 × 68 m pitch, each adding exactly its recorded time.

**If saving fails for a signed-in player** with "GPS storage isn't set up", the Supabase project is missing the GPS migration (step 3 of the account setup above). The wizard checks this when it opens.

**Quality.** Watch GPS is typically accurate to 3–10 m, and every GPS view says so. Screening excludes duplicate or out-of-order timestamps, low-accuracy fixes and impossible jumps (over 12 m/s), splits the recording at gaps, and never counts a gap as standing still. Insufficient recordings get no heatmap and point back to manual zones. The thresholds live in `src/lib/gps/screen.ts` and `src/lib/gps/quality.ts`.

**Heatmap.** Time-weighted (sampling rate doesn't change intensity), on a 1 m grid that extends 5 m past the lines so a player on the touchline is counted where recorded, with a light 2 m Gaussian blur. Positions are classified, never snapped. The same grid drives the 2D view (at the pitch's true proportions) and a single texture on the 3D pitch.

**Metrics.** Each one is labelled *from device*, *calculated*, *approximate* or *unavailable*: playing and tracked time, calculated distance (kept separate from the device's own), average speed over tracked time, a spike-proof top speed, heart rate only where it was recorded, and sprints only with every-second sampling.

**Storage.** Guests keep GPS data in the browser (IndexedDB). Signed-in players' data goes to Supabase: owner-only tables, ownership of the match enforced by the database (composite foreign keys plus RLS), source files in a private bucket under the player's own folder, and an atomic attach-and-replace function. Match lists never load GPS data; the heatmap grid loads only when shown. Raw coordinates are stored only in the original file, which is what makes re-trimming and recalibrating possible. Removing GPS from a match deletes its tracking and the file but never the match.

**Not yet:** Strava, Apple Health, Garmin Connect and Outplay sync; live phone GPS. A provider would implement `ActivitySource` in `src/lib/gps/adapter.ts` and produce the same normalised activity.

## Architecture

The whole career is a pure replay of the match log (`computeCareer`). XP, attributes, badges and milestones are never stored, so editing, deleting or importing a match can't leave stale numbers behind.

```
src/
  app/                 Routes (thin wrappers around screens)
  components/
    screens/           One client screen per route
    player/            Player card, attribute radar
    pitch/             SVG pitch, position picker, zone painter, heatmap, 3D pitch
    gps/               GPS import wizard, 2D GPS heatmap, match GPS panel
    match/             Match form and list rows
    career/            Charts, badges, timeline, rules page
    progression/       Post-match celebration sequence
    data/              JSON import and export
    account/           Sign-in form, account button, guest import prompt
    shared/, layout/   Primitives and the app shell
    ui/                shadcn/ui components
  lib/
    engine/            Progression rules, replay and achievements (unit tested)
    schema.ts          Zod schemas for forms, storage and imports
    store.ts           App state: guest localStorage or a synced account
    sync.ts            Outbox, diffing and merge rules for syncing (unit tested)
    auth.ts            Sign-in, sign-up, password reset and account deletion
    supabase.ts        Supabase client and database types
    heatmap.ts         Zone aggregation and density rendering
    gps/               GPS parsing, screening, calibration, heatmap engine, metrics, storage (unit tested)
    sample-data.ts     Demo career
supabase/
  migrations/          Database schema, row-level security and storage policies
scripts/gps/           Regenerates the synthetic FIT test fixture
```

## Data

As a guest, everything is stored in this browser's `localStorage`, so clearing site data deletes your career. Sign in to sync it, or use **Import / export** to keep a JSON backup. Imports are validated record by record, and merging skips matches you already have.

## Notes for contributors

Visited routes stay mounted through React `<Activity>` (a Cache Components behaviour), so local component state survives navigation. Forms must reset themselves after saving.
