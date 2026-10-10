-- Social backend for the balcade games (Tetris, Pong, Battleships, Chess), Supabase free tier.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Then: Authentication -> Sign In / Providers -> enable "Allow anonymous sign-ins".
-- Then put the Project URL and anon public key in tetris-config.js.
--
-- What lives here: player profiles (banner, bio, tags, badges, featured achievements, level/XP, points,
-- shop items), friendships, notifications (friend requests and game invites), the public high-score
-- table and the public lobby finder. Games themselves stay peer-to-peer (PeerJS); this only stores
-- the shared bits.
--
-- Trust model: everyone signs in anonymously and can only write their own rows (row level security).
-- XP, points and scores are reported by the player's browser, so a determined cheater can fake them.
-- The checks below cap obviously impossible values; they are speed bumps, not anti-cheat.

create table if not exists public.tetris_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Player' check (char_length(name) between 1 and 16),
  avatar text check (avatar is null or char_length(avatar) < 40000),
  banner text check (banner is null or char_length(banner) < 120000),
  bio text not null default '' check (char_length(bio) <= 190),
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  badges text[] not null default '{}' check (cardinality(badges) <= 3),
  featured text[] not null default '{}' check (cardinality(featured) <= 12),  -- 'game:id', up to 3 per game
  achievements jsonb not null default '{}'::jsonb,                               -- { 'game:id': unlock time ms }
  xp integer not null default 0 check (xp between 0 and 50000000),
  points integer not null default 0 check (points between 0 and 50000000),
  owned text[] not null default '{}' check (cardinality(owned) <= 200),
  equipped jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- One row per pair. requester asked; addressee accepts (status 'accepted') or either side deletes.
create table if not exists public.tetris_friends (
  requester uuid not null references public.tetris_profiles (id) on delete cascade,
  addressee uuid not null references public.tetris_profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- The bell: friend requests, accepted requests and game invites.
create table if not exists public.tetris_notifications (
  id bigint generated always as identity primary key,
  to_id uuid not null references public.tetris_profiles (id) on delete cascade,
  from_id uuid not null references public.tetris_profiles (id) on delete cascade,
  kind text not null check (kind in ('friend_request', 'friend_accept', 'invite')),
  lobby text check (lobby is null or lobby ~ '^[A-Z0-9]{5}$'),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tetris_notifications_to on public.tetris_notifications (to_id, created_at desc);

-- Public high scores for Tetris and Pong: every finished run, solo or versus, with or without skulls. The leaderboard filters
-- them with tags (game type, solo/versus, skulls...). value is what the run is ranked by: points, or tenths
-- of a second for Sprint/Dig (lower is better) and Survival (higher is better). Versus runs rank by points.
-- players: everyone in a versus game, for the run's info pane: [{ name, uid, cpu, score, lines, place }].
create table if not exists public.tetris_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.tetris_profiles (id) on delete cascade,
  game text not null default 'tetris' check (game in ('tetris', 'pong', 'battleships', 'chess')),
  kind text not null check (kind in ('solo', 'online', 'cpu')),
  mode text not null check (mode in ('marathon', 'sprint', 'ultra', 'dig', 'survival', 'versus', 'pong', 'battleships', 'chess')),
  versus_type text check (versus_type is null or versus_type in ('last', 'elim')),
  value integer not null check (value between 0 and 99999999),
  score integer not null default 0 check (score between 0 and 99999999),
  lines integer not null default 0 check (lines between 0 and 100000),
  level integer not null default 1 check (level between 1 and 999),
  elapsed integer not null default 0 check (elapsed between 0 and 86400000),
  skulls text[] not null default '{}' check (cardinality(skulls) <= 40),
  skull_count integer generated always as (cardinality(skulls)) stored,
  multiplier real not null default 1 check (multiplier between 0 and 50),
  won boolean,
  place integer check (place is null or place between 1 and 4),
  players jsonb check (players is null or (jsonb_typeof(players) = 'array' and jsonb_array_length(players) <= 4 and length(players::text) < 4000)),
  info jsonb check (info is null or (jsonb_typeof(info) = 'object' and length(info::text) < 1000)),  -- per-game extras (Pong: difficulty, target, ball...)
  created_at timestamptz not null default now()
);
create index if not exists tetris_runs_board on public.tetris_runs (game, mode, kind, skull_count, value);
create index if not exists tetris_runs_skulls on public.tetris_runs using gin (skulls);

-- Public lobby finder. The host's browser refreshes its row every ~15s; rows older than a minute are stale.
create table if not exists public.tetris_lobbies (
  code text primary key check (code ~ '^[A-Z0-9]{5}$'),
  game text not null default 'tetris' check (game in ('tetris', 'pong', 'battleships', 'chess')),
  host_id uuid not null references public.tetris_profiles (id) on delete cascade,
  host_name text not null check (char_length(host_name) between 1 and 16),
  players integer not null default 1 check (players between 0 and 4),
  max_players integer not null default 4 check (max_players between 2 and 4),
  rules text not null default '' check (char_length(rules) <= 80),
  in_game boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.tetris_profiles enable row level security;
alter table public.tetris_friends enable row level security;
alter table public.tetris_notifications enable row level security;
alter table public.tetris_runs enable row level security;
alter table public.tetris_lobbies enable row level security;

-- Profiles: public to read, only you can create or change yours.
drop policy if exists "profiles readable" on public.tetris_profiles;
create policy "profiles readable" on public.tetris_profiles for select using (true);
drop policy if exists "profiles insert own" on public.tetris_profiles;
create policy "profiles insert own" on public.tetris_profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.tetris_profiles;
create policy "profiles update own" on public.tetris_profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Friends: you see rows you're part of; you can ask (as requester), accept (as addressee) or remove either way.
drop policy if exists "friends read own" on public.tetris_friends;
create policy "friends read own" on public.tetris_friends for select using (auth.uid() in (requester, addressee));
drop policy if exists "friends request" on public.tetris_friends;
create policy "friends request" on public.tetris_friends for insert with check (auth.uid() = requester and status = 'pending');
drop policy if exists "friends accept" on public.tetris_friends;
create policy "friends accept" on public.tetris_friends for update using (auth.uid() = addressee) with check (auth.uid() = addressee);
drop policy if exists "friends remove" on public.tetris_friends;
create policy "friends remove" on public.tetris_friends for delete using (auth.uid() in (requester, addressee));

-- Notifications: anyone signed in can send one as themselves; only the recipient reads, marks or clears it.
drop policy if exists "notes send" on public.tetris_notifications;
create policy "notes send" on public.tetris_notifications for insert with check (auth.uid() = from_id and to_id <> from_id);
drop policy if exists "notes read" on public.tetris_notifications;
create policy "notes read" on public.tetris_notifications for select using (auth.uid() = to_id);
drop policy if exists "notes mark" on public.tetris_notifications;
create policy "notes mark" on public.tetris_notifications for update using (auth.uid() = to_id) with check (auth.uid() = to_id);
drop policy if exists "notes clear" on public.tetris_notifications;
create policy "notes clear" on public.tetris_notifications for delete using (auth.uid() = to_id);

-- Runs: public to read, you can only add your own (no edits or deletes).
drop policy if exists "runs readable" on public.tetris_runs;
create policy "runs readable" on public.tetris_runs for select using (true);
drop policy if exists "runs insert own" on public.tetris_runs;
create policy "runs insert own" on public.tetris_runs for insert with check (auth.uid() = user_id);

-- Lobbies: public to read, only the host writes its row.
drop policy if exists "lobbies readable" on public.tetris_lobbies;
create policy "lobbies readable" on public.tetris_lobbies for select using (true);
drop policy if exists "lobbies host insert" on public.tetris_lobbies;
create policy "lobbies host insert" on public.tetris_lobbies for insert with check (auth.uid() = host_id);
drop policy if exists "lobbies host update" on public.tetris_lobbies;
create policy "lobbies host update" on public.tetris_lobbies for update using (auth.uid() = host_id) with check (auth.uid() = host_id);
drop policy if exists "lobbies host delete" on public.tetris_lobbies;
create policy "lobbies host delete" on public.tetris_lobbies for delete using (auth.uid() = host_id);

-- Runs with the player's name and look, for the leaderboard. Filtering (game type, solo/versus, skulls,
-- friends) and best-per-player happen in the query and the browser.
drop view if exists public.tetris_board;
create view public.tetris_board with (security_invoker = true) as
select r.*, p.name, p.avatar, p.equipped, p.xp
from public.tetris_runs r
join public.tetris_profiles p on p.id = r.user_id;

-- Lobbies whose host refreshed them in the last minute (by the database clock).
drop view if exists public.tetris_open_lobbies;
create view public.tetris_open_lobbies with (security_invoker = true) as
select l.*, p.equipped, p.avatar, p.xp from public.tetris_lobbies l
join public.tetris_profiles p on p.id = l.host_id
where l.updated_at > now() - interval '60 seconds';

-- The database clock stamps profile and lobby changes, so every browser compares against one clock.
create or replace function public.tetris_touch() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'tetris_profiles' then new.updated_at := now(); new.last_seen := now();
  else new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists tetris_profiles_touch on public.tetris_profiles;
create trigger tetris_profiles_touch before insert or update on public.tetris_profiles for each row execute function public.tetris_touch();
drop trigger if exists tetris_lobbies_touch on public.tetris_lobbies;
create trigger tetris_lobbies_touch before insert or update on public.tetris_lobbies for each row execute function public.tetris_touch();

-- Housekeeping: drop stale lobbies and old read notifications whenever a lobby is published.
create or replace function public.tetris_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.tetris_lobbies where updated_at < now() - interval '10 minutes';
  delete from public.tetris_notifications where created_at < now() - interval '30 days';
  return new;
end $$;
drop trigger if exists tetris_lobbies_cleanup on public.tetris_lobbies;
create trigger tetris_lobbies_cleanup after insert on public.tetris_lobbies for each statement execute function public.tetris_cleanup();
