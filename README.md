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
- **Account → Delete account** removes the login and every synced match.

## How progression works

The rules live in `src/lib/engine/rules.ts`, and the in-app **Career → How it works** tab reads the same values, so the published rules can't drift from the real ones.

- **Attributes** start at 50. A skill rating sets a target of rating × 10, and each match closes 10% of the gap, scaled by minutes and format, capped at +2 / −1.5 per match.
- **Goals and assists** add a small bonus to SHO and PAS that shrinks as the attribute climbs.
- **Nothing is inferred.** Unrated skills don't move, attributes don't decay between matches, and the overall match rating only affects XP.
- **XP** is itemised per match: appearance, minutes, rating above 5, goals, assists, result and recorded clean sheets.
- **OVR** is a position-weighted average of the six attributes.

All ratings are self-assessed, so the card shows your own view of your game, not an external scouting report.

## Architecture

The whole career is a pure replay of the match log (`computeCareer`). XP, attributes, badges and milestones are never stored, so editing, deleting or importing a match can't leave stale numbers behind.

```
src/
  app/                 Routes (thin wrappers around screens)
  components/
    screens/           One client screen per route
    player/            Player card, attribute radar
    pitch/             SVG pitch, position picker, zone painter, heatmap
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
    sample-data.ts     Demo career
supabase/
  migrations/          Database schema and row-level security policies
```

## Data

As a guest, everything is stored in this browser's `localStorage`, so clearing site data deletes your career. Sign in to sync it, or use **Import / export** to keep a JSON backup. Imports are validated record by record, and merging skips matches you already have.

## Notes for contributors

Visited routes stay mounted through React `<Activity>` (a Cache Components behaviour), so local component state survives navigation. Forms must reset themselves after saving.
