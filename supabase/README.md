# balcade social backend (Supabase)

Profiles, friends, the notification bell, game invites, XP/levels, the points shop, achievement
sync, the public leaderboards and the public lobby finders for all four games store their shared
data in a Supabase project. Games themselves stay peer-to-peer (PeerJS); nothing here touches gameplay.

## Setup (once)

1. Create a free project at supabase.com.
2. **SQL Editor → New query**, paste all of `tetris-schema.sql`, **Run**. It's safe to run again.
3. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into
   `games-config.js` (`url` and `anonKey`). The anon key is meant to be public; the row level
   security rules in the schema decide who can read and write what.
5. Bump asset version numbers on changed files across all four game pages before deploying.

A project set up with the first Tetris-only schema needs the Pong migration and then the Battleships/Chess migration, each run once. Both were applied to this project on 2026-10-10. A fresh project can use tetris-schema.sql.

## One profile, four games

XP, level, points, shop items, badges, friends and invites are shared across the site. Achievements
are stored in the profile as `game:id` and sync both ways (earn one on your phone and it unlocks on
your PC, rewarded once). Each game page shows its own achievements. Runs and lobbies carry a `game` column so each page only shows its own.

With `url`/`anonKey` empty the social features are switched off and the page works as before.
Invite links for all four game pages work with or without social features.

## Testing without a project

Open any game page with the mockdb query parameter (add debug for console helpers). It uses a stand-in database kept in
`localStorage`, and each browser tab is a different player, so two tabs can friend, invite and find
each other's public lobbies. Clear it with `localStorage.removeItem('tetris_mockdb')`.

## Accounts

Everyone is signed in anonymously in the background; the account lives in that browser
(`localStorage` key `tetris-auth`). Clearing site data or switching browsers starts a new profile.
To use one account on several devices, link them with a QR code: chat › Settings › Devices & sync › Show QR code,
then scan it on the other device. This needs `migrations/2026-10-11-device-links.sql` (run once): a linked device
acts as the account it's linked to (every rule asks `tetris_me()` instead of `auth.uid()`). Each device keeps its
own chat code, listed on the profile as `equipped.chatDevices`, so friends can pick which device to message.

## Known limits

- XP, points and leaderboard scores are reported by the player's browser. Row level security stops
  people editing *other* players' data, and the schema caps impossible values, but someone editing
  their own browser can still fake their own numbers. Everything bought with points is cosmetic.
- Free projects pause after about a week with no traffic; the dashboard has a button to resume.
- Notifications are polled every 20 seconds (and when the tab regains focus), not pushed.
