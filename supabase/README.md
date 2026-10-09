# Tetris social backend (Supabase)

Profiles, friends, the notification bell, game invites, XP/levels, the points shop, the public
leaderboard and the public lobby finder on `/tetris` store their shared data in a free Supabase
project. Games themselves stay peer-to-peer (PeerJS); nothing here touches gameplay.

## Setup (once)

1. Create a free project at supabase.com.
2. **SQL Editor → New query**, paste all of `tetris-schema.sql`, **Run**. It's safe to run again.
3. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into
   `tetris-config.js` (`url` and `anonKey`). The anon key is meant to be public; the row level
   security rules in the schema decide who can read and write what.
5. Bump the `?v=` numbers on the Tetris files in `tetris.html` and deploy.

With `url`/`anonKey` empty the social features are switched off and the page works as before.
Invite links (`/tetris?join=CODE`) work either way.

## Testing without a project

Open `/tetris?mockdb` (add `&debug` for the console helpers). It uses a stand-in database kept in
`localStorage`, and each browser tab is a different player, so two tabs can friend, invite and find
each other's public lobbies. Clear it with `localStorage.removeItem('tetris_mockdb')`.

## Accounts

Everyone is signed in anonymously in the background; the account lives in that browser
(`localStorage` key `tetris-auth`). Clearing site data or switching browsers starts a new profile.
Linking an email so a profile can move between devices is not built yet.

## Known limits

- XP, points and leaderboard scores are reported by the player's browser. Row level security stops
  people editing *other* players' data, and the schema caps impossible values, but someone editing
  their own browser can still fake their own numbers. Everything bought with points is cosmetic.
- Free projects pause after about a week with no traffic; the dashboard has a button to resume.
- Notifications are polled every 20 seconds (and when the tab regains focus), not pushed.
